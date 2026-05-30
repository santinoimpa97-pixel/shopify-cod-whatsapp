import express from 'express'
import crypto from 'crypto'
import { getDb } from '../config/database.js'
import { updateShopifyOrderTag } from '../services/shopify.js'
import { sendWhatsAppMessage } from '../services/whatsapp.js'

const router = express.Router()

// 0. Debug Database Encoding (Temporary)
router.get('/debug-db', async (req, res) => {
  try {
    const db = await getDb()
    let dbType = 'unknown'
    let encodingInfo = {}
    
    // Check database type and encoding
    if (db.pool) {
      dbType = 'PostgreSQL'
      const serverEnc = await db.get('SHOW server_encoding')
      const clientEnc = await db.get('SHOW client_encoding')
      encodingInfo = {
        server_encoding: serverEnc,
        client_encoding: clientEnc
      }
    } else {
      dbType = 'SQLite'
      const pragmaEnc = await db.get('PRAGMA encoding')
      encodingInfo = {
        pragma_encoding: pragmaEnc
      }
    }

    const settings = await db.get('SELECT whatsapp_template FROM settings ORDER BY id DESC LIMIT 1')
    const template = settings ? settings.whatsapp_template : null
    const charAnalysis = []
    
    if (template) {
      for (let i = 0; i < template.length; i++) {
        const char = template[i]
        const code = template.charCodeAt(i)
        if (code > 127 || code === 63) { // Include non-ASCII and question marks
          charAnalysis.push({
            pos: i,
            char: char,
            code: code,
            hex: '0x' + code.toString(16).toUpperCase()
          })
        }
      }
    }

    return res.json({
      dbType,
      encodingInfo,
      templateLength: template ? template.length : 0,
      templateRaw: template,
      charAnalysis
    })
  } catch (error) {
    console.error('Debug DB Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// 1. Get configurations
router.get('/settings', async (req, res) => {
  try {
    const db = await getDb()
    const settings = await db.get('SELECT * FROM settings ORDER BY id DESC LIMIT 1')
    return res.json(settings || {})
  } catch (error) {
    console.error('Error fetching settings:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 2. Save configurations
router.post('/settings', async (req, res) => {
  const {
    shopify_store_url,
    shopify_client_id,
    shopify_client_secret,
    shopify_access_token,
    shopify_webhook_secret,
    app_url,
    whatsapp_provider,
    whatsapp_api_url,
    whatsapp_api_token,
    whatsapp_instance_id,
    whatsapp_template,
    whatsapp_template_abandoned,
    whatsapp_template_draft
  } = req.body

  try {
    const db = await getDb()
    
    // Check if settings row exists
    const settings = await db.get('SELECT id FROM settings ORDER BY id DESC LIMIT 1')

    if (settings) {
      // Update existing
      await db.run(
        `UPDATE settings SET
          shopify_store_url = ?,
          shopify_client_id = ?,
          shopify_client_secret = ?,
          shopify_access_token = ?,
          shopify_webhook_secret = ?,
          app_url = ?,
          whatsapp_provider = ?,
          whatsapp_api_url = ?,
          whatsapp_api_token = ?,
          whatsapp_instance_id = ?,
          whatsapp_template = ?,
          whatsapp_template_abandoned = ?,
          whatsapp_template_draft = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          shopify_store_url,
          shopify_client_id,
          shopify_client_secret,
          shopify_access_token,
          shopify_webhook_secret,
          app_url,
          whatsapp_provider,
          whatsapp_api_url,
          whatsapp_api_token,
          whatsapp_instance_id,
          whatsapp_template,
          whatsapp_template_abandoned,
          whatsapp_template_draft,
          settings.id
        ]
      )
    } else {
      // Insert new
      await db.run(
        `INSERT INTO settings (
          shopify_store_url, shopify_client_id, shopify_client_secret, shopify_access_token, shopify_webhook_secret, app_url,
          whatsapp_provider, whatsapp_api_url, whatsapp_api_token, whatsapp_instance_id, whatsapp_template, whatsapp_template_abandoned, whatsapp_template_draft
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shopify_store_url,
          shopify_client_id,
          shopify_client_secret,
          shopify_access_token,
          shopify_webhook_secret,
          app_url,
          whatsapp_provider,
          whatsapp_api_url,
          whatsapp_api_token,
          whatsapp_instance_id,
          whatsapp_template,
          whatsapp_template_abandoned,
          whatsapp_template_draft
        ]
      )
    }

    return res.json({ success: true, message: 'Impostazioni salvate correttamente' })
  } catch (error) {
    console.error('Error saving settings:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 2b. Shopify OAuth Initiation
router.get('/shopify/auth', async (req, res) => {
  const { shop } = req.query

  if (!shop) {
    return res.status(400).send('Negozio Shopify mancante (parametro shop).')
  }

  try {
    const db = await getDb()
    const settings = await db.get('SELECT shopify_client_id, app_url FROM settings ORDER BY id DESC LIMIT 1')

    if (!settings || !settings.shopify_client_id || !settings.app_url) {
      return res.status(400).send('Configurazione incompleta nell\'app. Inserisci il Client ID e l\'URL dell\'App prima di collegare Shopify.')
    }

    const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
    const redirectUri = `${settings.app_url.trim().replace(/\/$/, '')}/api/shopify/auth/callback`
    const authorizeUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${settings.shopify_client_id.trim()}&scope=read_orders,write_orders,read_draft_orders,read_customers&redirect_uri=${encodeURIComponent(redirectUri)}`

    console.log(`[Shopify Auth] Reindirizzamento a OAuth: ${authorizeUrl}`)
    return res.redirect(authorizeUrl)
  } catch (error) {
    console.error('[Shopify Auth] Errore inziale OAuth:', error)
    return res.status(500).send('Errore interno del server durante l\'inizializzazione OAuth.')
  }
})

// 2c. Shopify OAuth Callback
router.get('/shopify/auth/callback', async (req, res) => {
  const { code, shop } = req.query

  if (!code || !shop) {
    return res.status(400).send('Dati di autorizzazione Shopify mancanti.')
  }

  try {
    const db = await getDb()
    const settings = await db.get('SELECT id, shopify_client_id, shopify_client_secret, app_url FROM settings ORDER BY id DESC LIMIT 1')

    if (!settings || !settings.shopify_client_id || !settings.shopify_client_secret) {
      return res.status(400).send('Credenziali client (ID/Segreto) non trovate nelle impostazioni.')
    }

    // Exchange temporary code for permanent offline access token
    const tokenUrl = `https://${shop}/admin/oauth/access_token`
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: settings.shopify_client_id.trim(),
        client_secret: settings.shopify_client_secret.trim(),
        code
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Scambio token non riuscito: ${response.status} - ${errText}`)
    }

    const data = await response.json()
    const accessToken = data.access_token

    // Save access token and shop URL
    await db.run(
      `UPDATE settings SET
        shopify_store_url = ?,
        shopify_access_token = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [shop, accessToken, settings.id]
    )

    console.log(`[Shopify Auth] Collegamento riuscito per il negozio: ${shop}`)
    
    // Redirect back to frontend dashboard
    const appUrl = settings.app_url.trim().replace(/\/$/, '')
    return res.redirect(`${appUrl}?auth=success`)
  } catch (error) {
    console.error('[Shopify Auth] Errore callback OAuth:', error)
    return res.status(500).send(`Errore durante il collegamento a Shopify: ${error.message}`)
  }
})

// 2d. Sync recent COD orders from Shopify
router.post('/shopify/sync', async (req, res) => {
  try {
    const db = await getDb()
    const settings = await db.get('SELECT shopify_store_url, shopify_access_token FROM settings ORDER BY id DESC LIMIT 1')

    if (!settings || !settings.shopify_store_url || !settings.shopify_access_token) {
      return res.status(400).json({ error: 'Configurazione Shopify incompleta o non collegata.' })
    }

    const shop = settings.shopify_store_url.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
    const accessToken = settings.shopify_access_token.trim()
    
    // Fetch last 50 orders from Shopify
    const shopifyUrl = `https://${shop}/admin/api/2024-04/orders.json?limit=50&status=any`
    const response = await fetch(shopifyUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Errore API Shopify: ${response.status} - ${errText}`)
    }

    const data = await response.json()
    const orders = data.orders || []
    let importedCount = 0
    let updatedCount = 0

    for (const order of orders) {
      // 1. Check if COD
      const gateways = order.payment_gateway_names || []
      const gateway = order.gateway || ''
      const isCod = gateways.some(g => {
        const name = g.toLowerCase()
        return name.includes('cod') || name.includes('cash') || name.includes('contrassegno') || name.includes('manual')
      }) || gateway.toLowerCase().includes('cod') || gateway.toLowerCase().includes('cash') || gateway.toLowerCase().includes('contrassegno') || gateway.toLowerCase().includes('manual')

      if (!isCod) continue

      // Check if already in DB to preserve token and track status changes
      const existing = await db.get('SELECT status, token FROM orders WHERE shopify_order_id = ?', [order.id.toString()])

      // 2. Extract customer info
      const customerName = order.customer 
        ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
        : 'Cliente Shopify'
        
      const phone = order.phone || 
                    (order.customer && order.customer.phone) || 
                    (order.shipping_address && order.shipping_address.phone) || 
                    (order.billing_address && order.billing_address.phone) || 
                    null

      let cleanPhone = 'Nessun numero'
      if (phone) {
        cleanPhone = phone.replace(/[^0-9]/g, '')
        if (cleanPhone.startsWith('3') && cleanPhone.length === 10) {
          cleanPhone = '39' + cleanPhone
        }
      }

      // 3. Determine status from Shopify order properties
      let status = 'pending'
      const financialStatus = order.financial_status ? order.financial_status.toLowerCase() : ''
      const fulfillmentStatus = order.fulfillment_status ? order.fulfillment_status.toLowerCase() : ''
      const isCancelled = order.cancelled_at !== null || financialStatus === 'voided' || financialStatus === 'refunded'
      const isPaidOrFulfilled = financialStatus === 'paid' || fulfillmentStatus === 'fulfilled'
      const tags = order.tags ? order.tags.split(',').map(t => t.trim().toLowerCase()) : []

      if (isCancelled || tags.includes('cod annullato')) {
        status = 'cancelled'
      } else if (isPaidOrFulfilled || tags.includes('cod confermato')) {
        status = 'confirmed'
      } else if (phone) {
        status = 'pending'
      } else {
        status = 'failed' // phone missing
      }

      const token = existing ? existing.token : crypto.randomUUID()

      await db.run(
        `INSERT INTO orders (id, shopify_order_id, order_number, customer_name, customer_phone, total_price, currency, payment_gateway, status, whatsapp_status, token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(shopify_order_id) DO UPDATE SET
           status = excluded.status,
           customer_name = excluded.customer_name,
           customer_phone = excluded.customer_phone,
           total_price = excluded.total_price,
           created_at = excluded.created_at,
           updated_at = CURRENT_TIMESTAMP`,
        [
          order.id.toString(),
          order.id.toString(),
          order.order_number.toString(),
          customerName,
          cleanPhone,
          order.total_price,
          order.currency,
          gateways.join(', ') || gateway,
          status,
          status === 'pending' ? 'pending' : 'sent',
          token,
          order.created_at
        ]
      )

      if (!existing) {
        importedCount++
      } else if (existing.status !== status) {
        updatedCount++
      }
    }

    let summaryMessage = `Sincronizzazione completata! `
    if (importedCount > 0 || updatedCount > 0) {
      summaryMessage += `Importati ${importedCount} nuovi ordini COD, aggiornati ${updatedCount} ordini esistenti.`
    } else {
      summaryMessage += `Tutti gli ordini sono già allineati.`
    }

    return res.json({ success: true, message: summaryMessage })
  } catch (error) {
    console.error('[Shopify Sync] Errore sincronizzazione:', error)
    return res.status(500).json({ error: `Errore sincronizzazione: ${error.message}` })
  }
})

// 3. Get orders list with search and filter
router.get('/orders', async (req, res) => {
  const { search, status, limit = 50, offset = 0 } = req.query

  try {
    const db = await getDb()
    
    let query = 'SELECT * FROM orders WHERE 1=1'
    const params = []

    if (status && status !== 'all') {
      query += ' AND status = ?'
      params.push(status)
    }

    if (search) {
      query += ' AND (order_number LIKE ? OR LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)'
      params.push(`%${search}%`, `%${search.toLowerCase()}%`, `%${search}%`)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit, 10), parseInt(offset, 10))

    const orders = await db.all(query, params)
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as count FROM orders WHERE 1=1'
    const countParams = []

    if (status && status !== 'all') {
      countQuery += ' AND status = ?'
      countParams.push(status)
    }

    if (search) {
      countQuery += ' AND (order_number LIKE ? OR LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)'
      countParams.push(`%${search}%`, `%${search.toLowerCase()}%`, `%${search}%`)
    }

    const countResult = await db.get(countQuery, countParams)

    return res.json({
      orders,
      total: countResult.count
    })
  } catch (error) {
    console.error('Error fetching orders:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 4. Get Statistics
router.get('/stats', async (req, res) => {
  try {
    const db = await getDb()

    // 1. Orders Stats
    const total = await db.get('SELECT COUNT(*) as count FROM orders')
    const confirmed = await db.get("SELECT COUNT(*) as count FROM orders WHERE status = 'confirmed'")
    const pending = await db.get("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'")
    const sent = await db.get("SELECT COUNT(*) as count FROM orders WHERE status = 'sent'")
    const cancelled = await db.get("SELECT COUNT(*) as count FROM orders WHERE status = 'cancelled'")
    const failed = await db.get("SELECT COUNT(*) as count FROM orders WHERE status = 'failed'")

    const convRate = total.count > 0 
      ? Math.round((confirmed.count / total.count) * 100) 
      : 0

    // 2. Abandoned Checkouts Stats
    const totalAbandoned = await db.get('SELECT COUNT(*) as count FROM abandoned_checkouts')
    const recoveredAbandoned = await db.get("SELECT COUNT(*) as count FROM abandoned_checkouts WHERE status = 'recovered'")
    const recoveryRate = totalAbandoned.count > 0
      ? Math.round((recoveredAbandoned.count / totalAbandoned.count) * 100)
      : 0

    // 3. Draft Orders Stats
    const totalDrafts = await db.get('SELECT COUNT(*) as count FROM draft_orders')
    const completedDrafts = await db.get("SELECT COUNT(*) as count FROM draft_orders WHERE status = 'completed'")
    const draftCompletionRate = totalDrafts.count > 0
      ? Math.round((completedDrafts.count / totalDrafts.count) * 100)
      : 0

    return res.json({
      total: total.count,
      confirmed: confirmed.count,
      pending: pending.count,
      sent: sent.count,
      cancelled: cancelled.count,
      failed: failed.count,
      conversionRate: convRate,
      
      // New stats
      abandoned: {
        total: totalAbandoned.count,
        recovered: recoveredAbandoned.count,
        rate: recoveryRate
      },
      drafts: {
        total: totalDrafts.count,
        completed: completedDrafts.count,
        rate: draftCompletionRate
      }
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 5. Manually send/resend WhatsApp
router.post('/orders/:id/resend-whatsapp', async (req, res) => {
  const { id } = req.params

  try {
    const result = await sendWhatsAppMessage(id)
    if (result.success) {
      return res.json({ success: true, message: 'Messaggio WhatsApp inviato correttamente' })
    } else {
      return res.status(400).json({ success: false, error: result.error || result.reason })
    }
  } catch (error) {
    console.error(`Error resending WhatsApp for order ${id}:`, error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
})

// 6. Manually Confirm Order
router.post('/orders/:id/confirm', async (req, res) => {
  const { id } = req.params

  try {
    const db = await getDb()
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [id])
    
    if (!order) {
      return res.status(404).json({ error: 'Ordine non trovato' })
    }

    // Update in local DB
    await db.run(
      "UPDATE orders SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    )

    // Update Shopify (add 'cod confermato', remove 'cod annullato')
    let shopifyUpdated = true
    let shopifyErrorMsg = ''
    try {
      await updateShopifyOrderTag(order.shopify_order_id, 'cod confermato', 'cod annullato')
    } catch (shopifyErr) {
      console.error(`[Manual Confirm] Shopify update failed for order ${order.order_number}:`, shopifyErr.message)
      shopifyUpdated = false
      shopifyErrorMsg = shopifyErr.message
    }

    return res.json({ 
      success: true, 
      shopifyUpdated,
      shopifyError: shopifyErrorMsg,
      message: shopifyUpdated 
        ? 'Ordine confermato e tag aggiornato su Shopify' 
        : 'Ordine confermato localmente, ma non è stato possibile aggiornare Shopify (verifica le credenziali).'
    })
  } catch (error) {
    console.error(`Error manually confirming order ${id}:`, error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 7. Manually Cancel Order
router.post('/orders/:id/cancel', async (req, res) => {
  const { id } = req.params

  try {
    const db = await getDb()
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [id])
    
    if (!order) {
      return res.status(404).json({ error: 'Ordine non trovato' })
    }

    // Update in local DB
    await db.run(
      "UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    )

    // Update Shopify (add 'cod annullato', remove 'cod confermato')
    let shopifyUpdated = true
    let shopifyErrorMsg = ''
    try {
      await updateShopifyOrderTag(order.shopify_order_id, 'cod annullato', 'cod confermato')
    } catch (shopifyErr) {
      console.error(`[Manual Cancel] Shopify update failed for order ${order.order_number}:`, shopifyErr.message)
      shopifyUpdated = false
      shopifyErrorMsg = shopifyErr.message
    }

    return res.json({ 
      success: true, 
      shopifyUpdated,
      shopifyError: shopifyErrorMsg,
      message: shopifyUpdated 
        ? 'Ordine contrassegnato come annullato e tag aggiornato su Shopify' 
        : 'Ordine annullato localmente, ma non è stato possibile aggiornare Shopify.'
    })
  } catch (error) {
    console.error(`Error manually cancelling order ${id}:`, error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 8. Sync abandoned checkouts from Shopify via GraphQL
router.post('/shopify/sync-abandoned', async (req, res) => {
  try {
    const db = await getDb()
    const settings = await db.get('SELECT shopify_store_url, shopify_access_token FROM settings ORDER BY id DESC LIMIT 1')

    if (!settings || !settings.shopify_store_url || !settings.shopify_access_token) {
      return res.status(400).json({ error: 'Configurazione Shopify incompleta o non collegata.' })
    }

    const shop = settings.shopify_store_url.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
    const accessToken = settings.shopify_access_token.trim()
    
    const shopifyUrl = `https://${shop}/admin/api/2024-04/graphql.json`
    
    const graphqlQuery = `
      query AbandonedCheckouts {
        abandonedCheckouts(first: 50) {
          nodes {
            id
            abandonedCheckoutUrl
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              phone
              email
            }
            shippingAddress {
              firstName
              lastName
              phone
            }
            billingAddress {
              phone
            }
          }
        }
      }
    `

    const response = await fetch(shopifyUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: graphqlQuery })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Errore API Shopify GraphQL: ${response.status} - ${errText}`)
    }

    const resJson = await response.json()
    if (resJson.errors) {
      throw new Error(`Errore GraphQL: ${JSON.stringify(resJson.errors)}`)
    }

    const nodes = resJson.data?.abandonedCheckouts?.nodes || []
    let importedCount = 0
    let updatedCount = 0

    for (const node of nodes) {
      const customer = node.customer
      const shippingAddress = node.shippingAddress
      const billingAddress = node.billingAddress

      const customerName = customer 
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
        : (shippingAddress 
            ? `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim()
            : 'Cliente Shopify')

      const rawPhone = customer?.phone || 
                       shippingAddress?.phone || 
                       billingAddress?.phone || 
                       null

      let cleanPhone = 'Nessun numero'
      if (rawPhone) {
        cleanPhone = rawPhone.replace(/[^0-9]/g, '')
        if (cleanPhone.startsWith('3') && cleanPhone.length === 10) {
          cleanPhone = '39' + cleanPhone
        }
      }

      const totalPrice = node.totalPriceSet?.shopMoney?.amount || '0.00'
      const currency = node.totalPriceSet?.shopMoney?.currencyCode || 'EUR'

      const existing = await db.get('SELECT status, token FROM abandoned_checkouts WHERE shopify_checkout_id = ?', [node.id])
      const token = existing ? existing.token : crypto.randomUUID()
      const status = existing ? existing.status : (rawPhone ? 'pending' : 'failed')

      await db.run(
        `INSERT INTO abandoned_checkouts (id, shopify_checkout_id, customer_name, customer_phone, total_price, currency, abandoned_checkout_url, status, whatsapp_status, token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(shopify_checkout_id) DO UPDATE SET
           customer_name = excluded.customer_name,
           customer_phone = excluded.customer_phone,
           total_price = excluded.total_price,
           abandoned_checkout_url = excluded.abandoned_checkout_url,
           updated_at = CURRENT_TIMESTAMP`,
        [
          node.id,
          node.id,
          customerName,
          cleanPhone,
          totalPrice,
          currency,
          node.abandonedCheckoutUrl,
          status,
          existing ? (existing.whatsapp_status || 'sent') : (rawPhone ? 'pending' : 'failed'),
          token,
          node.createdAt
        ]
      )

      if (!existing) {
        importedCount++
      } else {
        updatedCount++
      }
    }

    return res.json({
      success: true,
      message: `Sincronizzazione carrelli abbandonati completata! Importati ${importedCount} nuovi carrelli, aggiornati ${updatedCount} esistenti.`
    })
  } catch (error) {
    console.error('[Shopify Abandoned Sync] Errore:', error)
    return res.status(500).json({ error: `Errore sincronizzazione carrelli: ${error.message}` })
  }
})

// 9. Sync Draft Orders from Shopify via GraphQL
router.post('/shopify/sync-drafts', async (req, res) => {
  try {
    const db = await getDb()
    const settings = await db.get('SELECT shopify_store_url, shopify_access_token FROM settings ORDER BY id DESC LIMIT 1')

    if (!settings || !settings.shopify_store_url || !settings.shopify_access_token) {
      return res.status(400).json({ error: 'Configurazione Shopify incompleta o non collegata.' })
    }

    const shop = settings.shopify_store_url.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
    const accessToken = settings.shopify_access_token.trim()
    
    const shopifyUrl = `https://${shop}/admin/api/2024-04/graphql.json`
    
    const graphqlQuery = `
      query DraftOrders {
        draftOrders(first: 50) {
          nodes {
            id
            name
            status
            invoiceUrl
            createdAt
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            customer {
              firstName
              lastName
              phone
              email
            }
            shippingAddress {
              firstName
              lastName
              phone
            }
            billingAddress {
              phone
            }
          }
        }
      }
    `

    const response = await fetch(shopifyUrl, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: graphqlQuery })
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Errore API Shopify GraphQL Drafts: ${response.status} - ${errText}`)
    }

    const resJson = await response.json()
    if (resJson.errors) {
      throw new Error(`Errore GraphQL Drafts: ${JSON.stringify(resJson.errors)}`)
    }

    const nodes = resJson.data?.draftOrders?.nodes || []
    let importedCount = 0
    let updatedCount = 0

    for (const node of nodes) {
      const customer = node.customer
      const shippingAddress = node.shippingAddress
      const billingAddress = node.billingAddress

      const customerName = customer 
        ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
        : (shippingAddress 
            ? `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim()
            : 'Cliente Shopify')

      const rawPhone = customer?.phone || 
                       shippingAddress?.phone || 
                       billingAddress?.phone || 
                       null

      let cleanPhone = 'Nessun numero'
      if (rawPhone) {
        cleanPhone = rawPhone.replace(/[^0-9]/g, '')
        if (cleanPhone.startsWith('3') && cleanPhone.length === 10) {
          cleanPhone = '39' + cleanPhone
        }
      }

      const totalPrice = node.totalPriceSet?.shopMoney?.amount || '0.00'
      const currency = node.totalPriceSet?.shopMoney?.currencyCode || 'EUR'

      const existing = await db.get('SELECT status, token FROM draft_orders WHERE shopify_draft_order_id = ? OR shopify_draft_order_id = ?', [node.id, node.id.split('/').pop()])
      const token = existing ? existing.token : crypto.randomUUID()
      
      let status = 'open'
      const gqlStatus = node.status ? node.status.toLowerCase() : 'open'
      if (gqlStatus === 'completed') {
        status = 'completed'
      } else if (gqlStatus === 'invoice_sent') {
        status = 'invoice_sent'
      }

      await db.run(
        `INSERT INTO draft_orders (id, shopify_draft_order_id, draft_order_number, customer_name, customer_phone, total_price, currency, invoice_url, status, whatsapp_status, token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(shopify_draft_order_id) DO UPDATE SET
           customer_name = excluded.customer_name,
           customer_phone = excluded.customer_phone,
           total_price = excluded.total_price,
           invoice_url = excluded.invoice_url,
           status = CASE WHEN draft_orders.status = 'completed' THEN 'completed' ELSE excluded.status END,
           updated_at = CURRENT_TIMESTAMP`,
        [
          node.id,
          node.id,
          node.name.toString(),
          customerName,
          cleanPhone,
          totalPrice,
          currency,
          node.invoiceUrl,
          status,
          existing ? (existing.whatsapp_status || 'sent') : (rawPhone ? 'pending' : 'failed'),
          token,
          node.createdAt
        ]
      )

      if (!existing) {
        importedCount++
      } else {
        updatedCount++
      }
    }

    return res.json({
      success: true,
      message: `Sincronizzazione bozze d'ordine completata! Importate ${importedCount} nuove bozze, aggiornate ${updatedCount} esistenti.`
    })
  } catch (error) {
    console.error('[Shopify Drafts Sync] Errore:', error)
    return res.status(500).json({ error: `Errore sincronizzazione bozze: ${error.message}` })
  }
})

// 10. Get abandoned checkouts list
router.get('/abandoned-checkouts', async (req, res) => {
  const { search, status, limit = 50, offset = 0 } = req.query

  try {
    const db = await getDb()
    let query = 'SELECT * FROM abandoned_checkouts WHERE 1=1'
    const params = []

    if (status && status !== 'all') {
      query += ' AND status = ?'
      params.push(status)
    }

    if (search) {
      query += ' AND (LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)'
      params.push(`%${search.toLowerCase()}%`, `%${search}%`)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit, 10), parseInt(offset, 10))

    const checkouts = await db.all(query, params)
    
    let countQuery = 'SELECT COUNT(*) as count FROM abandoned_checkouts WHERE 1=1'
    const countParams = []

    if (status && status !== 'all') {
      countQuery += ' AND status = ?'
      countParams.push(status)
    }

    if (search) {
      countQuery += ' AND (LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)'
      countParams.push(`%${search.toLowerCase()}%`, `%${search}%`)
    }

    const countResult = await db.get(countQuery, countParams)

    return res.json({
      checkouts,
      total: countResult.count
    })
  } catch (error) {
    console.error('Error fetching abandoned checkouts:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 11. Get draft orders list
router.get('/draft-orders', async (req, res) => {
  const { search, status, limit = 50, offset = 0 } = req.query

  try {
    const db = await getDb()
    let query = 'SELECT * FROM draft_orders WHERE 1=1'
    const params = []

    if (status && status !== 'all') {
      query += ' AND status = ?'
      params.push(status)
    }

    if (search) {
      query += ' AND (draft_order_number LIKE ? OR LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)'
      params.push(`%${search}%`, `%${search.toLowerCase()}%`, `%${search}%`)
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit, 10), parseInt(offset, 10))

    const drafts = await db.all(query, params)
    
    let countQuery = 'SELECT COUNT(*) as count FROM draft_orders WHERE 1=1'
    const countParams = []

    if (status && status !== 'all') {
      countQuery += ' AND status = ?'
      countParams.push(status)
    }

    if (search) {
      countQuery += ' AND (draft_order_number LIKE ? OR LOWER(customer_name) LIKE ? OR customer_phone LIKE ?)'
      countParams.push(`%${search}%`, `%${search.toLowerCase()}%`, `%${search}%`)
    }

    const countResult = await db.get(countQuery, countParams)

    return res.json({
      drafts,
      total: countResult.count
    })
  } catch (error) {
    console.error('Error fetching draft orders:', error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 12. Manually resend WhatsApp for Abandoned Checkout
router.post('/abandoned-checkouts/:id/resend-whatsapp', async (req, res) => {
  const { id } = req.params
  try {
    const result = await sendWhatsAppMessage(id, 'abandoned')
    if (result.success) {
      return res.json({ success: true, message: 'Messaggio WhatsApp inviato correttamente' })
    } else {
      return res.status(400).json({ success: false, error: result.error || result.reason })
    }
  } catch (error) {
    console.error(`Error resending WhatsApp for abandoned checkout ${id}:`, error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
})

// 13. Manually resend WhatsApp for Draft Order
router.post('/draft-orders/:id/resend-whatsapp', async (req, res) => {
  const { id } = req.params
  try {
    const result = await sendWhatsAppMessage(id, 'draft')
    if (result.success) {
      return res.json({ success: true, message: 'Messaggio WhatsApp inviato correttamente' })
    } else {
      return res.status(400).json({ success: false, error: result.error || result.reason })
    }
  } catch (error) {
    console.error(`Error resending WhatsApp for draft order ${id}:`, error)
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
})

// 14. Manually Recover Abandoned Checkout
router.post('/abandoned-checkouts/:id/recover', async (req, res) => {
  const { id } = req.params
  try {
    const db = await getDb()
    await db.run("UPDATE abandoned_checkouts SET status = 'recovered', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id])
    return res.json({ success: true, message: 'Carrello contrassegnato come recuperato' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

// 15. Manually Complete Draft Order
router.post('/draft-orders/:id/complete', async (req, res) => {
  const { id } = req.params
  try {
    const db = await getDb()
    await db.run("UPDATE draft_orders SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [id])
    return res.json({ success: true, message: 'Bozza d\'ordine contrassegnata come completata' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Internal Server Error' })
  }
})

export default router
