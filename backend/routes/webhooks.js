import express from 'express'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../config/database.js'
import { sendWhatsAppMessage } from '../services/whatsapp.js'

const router = express.Router()

// Middleware to verify Shopify Webhook signature
async function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256']
  if (!hmacHeader) {
    console.error('Shopify Webhook verification failed: Missing X-Shopify-Hmac-Sha256 header')
    return res.status(401).send('Unauthorized')
  }

  try {
    const db = await getDb()
    const settings = await db.get('SELECT shopify_webhook_secret FROM settings ORDER BY id DESC LIMIT 1')
    
    // If no webhook secret is configured yet, we skip signature verification (useful for initial dev setup)
    if (!settings || !settings.shopify_webhook_secret) {
      console.warn('WARNING: Shopify Webhook Secret is not configured in settings. Skipping signature verification.')
      return next()
    }

    const calculatedHmac = crypto
      .createHmac('sha256', settings.shopify_webhook_secret)
      .update(req.rawBody)
      .digest('base64')

    if (calculatedHmac === hmacHeader) {
      return next()
    } else {
      console.error('Shopify Webhook verification failed: HMAC mismatch')
      return res.status(401).send('Unauthorized')
    }
  } catch (error) {
    console.error('Error during webhook signature verification:', error)
    return res.status(500).send('Internal Server Error')
  }
}

// Shopify orders/create webhook handler
router.post('/shopify/orders-create', verifyShopifyWebhook, async (req, res) => {
  const order = req.body
  console.log(`Received order webhook for Shopify Order ID: ${order.id}, Number: ${order.order_number}`)

  try {
    const db = await getDb()

    // 1. Check if the order payment gateway indicates COD (Contrassegno)
    const gateways = order.payment_gateway_names || []
    const gateway = order.gateway || ''
    
    const isCod = gateways.some(g => {
      const name = g.toLowerCase()
      return name.includes('cod') || name.includes('cash') || name.includes('contrassegno') || name.includes('manual')
    }) || gateway.toLowerCase().includes('cod') || gateway.toLowerCase().includes('cash') || gateway.toLowerCase().includes('contrassegno') || gateway.toLowerCase().includes('manual')

    if (!isCod) {
      console.log(`Order ${order.order_number} is NOT a COD order. Gateway: ${JSON.stringify(gateways)} / ${gateway}. Skipping.`)
      return res.status(200).send('Skipped: Not a COD order')
    }

    // 2. Extract customer details robustly
    const customerName = order.customer 
      ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
      : 'Cliente Shopify'
      
    // Try to find the phone number in multiple fields
    const phone = order.phone || 
                  (order.customer && order.customer.phone) || 
                  (order.shipping_address && order.shipping_address.phone) || 
                  (order.billing_address && order.billing_address.phone) || 
                  null

    if (!phone) {
      console.warn(`Order ${order.order_number} has no phone number. Cannot send WhatsApp.`)
      // Save it as failed in DB
      const token = uuidv4()
      await db.run(
        `INSERT INTO orders (id, shopify_order_id, order_number, customer_name, customer_phone, total_price, currency, payment_gateway, status, whatsapp_status, token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.id.toString(),
          order.id.toString(),
          order.order_number.toString(),
          customerName,
          'Nessun numero',
          order.total_price,
          order.currency,
          gateways.join(', ') || gateway,
          'failed',
          'failed',
          token,
          order.created_at
        ]
      )
      return res.status(200).send('Logged with error: Phone missing')
    }

    // Clean phone number (remove spaces, plus, dashes, but ensure country code)
    let cleanPhone = phone.replace(/[^0-9]/g, '')
    // Default to Italian country code (39) if number starts with 3 (mobile) and has 10 digits
    if (cleanPhone.startsWith('3') && cleanPhone.length === 10) {
      cleanPhone = '39' + cleanPhone
    }

    // 3. Save order to local SQLite database
    const token = uuidv4()
    await db.run(
      `INSERT INTO orders (id, shopify_order_id, order_number, customer_name, customer_phone, total_price, currency, payment_gateway, status, whatsapp_status, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(shopify_order_id) DO UPDATE SET
         customer_name = excluded.customer_name,
         customer_phone = excluded.customer_phone,
         total_price = excluded.total_price,
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
        'pending',
        'pending',
        token,
        order.created_at
      ]
    )

    console.log(`Order ${order.order_number} saved to local DB. Token: ${token}`)

    // 4. Trigger WhatsApp message sending (asynchronous)
    sendWhatsAppMessage(order.id.toString())
      .then(result => {
        console.log(`WhatsApp send task completed for order ${order.order_number}:`, result)
      })
      .catch(err => {
        console.error(`WhatsApp send task failed for order ${order.order_number}:`, err)
      })

    return res.status(200).send('Order received and queueing WhatsApp')
  } catch (error) {
    console.error('Error handling Shopify orders-create webhook:', error)
    return res.status(500).send('Internal Server Error')
  }
})

export default router
