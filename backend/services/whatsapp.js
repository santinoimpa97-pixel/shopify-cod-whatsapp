import { getDb } from '../config/database.js'

/**
 * Sends a WhatsApp message for a given order using the configured provider.
 * 
 * @param {string} orderId - Shopify Order ID
 */
export async function sendWhatsAppMessage(orderId) {
  let db
  try {
    db = await getDb()
    
    // 1. Fetch order details
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId])
    if (!order) {
      throw new Error(`Ordine ${orderId} non trovato nel database.`)
    }

    if (order.customer_phone === 'Nessun numero' || !order.customer_phone) {
      console.log(`[WhatsApp] Salto invio per ordine ${order.order_number}: nessun numero di telefono.`)
      return { success: false, reason: 'Nessun telefono' }
    }

    // 2. Fetch settings
    const settings = await db.get('SELECT * FROM settings ORDER BY id DESC LIMIT 1')
    if (!settings) {
      throw new Error('Impostazioni non configurate.')
    }

    const {
      whatsapp_provider,
      whatsapp_api_url,
      whatsapp_api_token,
      whatsapp_instance_id,
      whatsapp_template,
      app_url
    } = settings

    if (!whatsapp_provider || whatsapp_provider === 'manual') {
      console.log(`[WhatsApp] Provider impostato su "manual". Salto invio automatico per l'ordine ${order.order_number}.`)
      return { success: true, status: 'manual' }
    }

    // 3. Construct confirmation link
    const domain = app_url ? app_url.trim().replace(/\/$/, '') : 'http://localhost:5000'
    const confirmLink = `${domain}/confirm/${order.token}`

    // 4. Construct message text by replacing placeholders
    let messageText = whatsapp_template || ''
    messageText = messageText
      .replace(/{customer_name}/g, order.customer_name || 'Cliente')
      .replace(/{order_number}/g, order.order_number || '')
      .replace(/{order_total}/g, `${order.total_price} ${order.currency}`)
      .replace(/{confirm_link}/g, confirmLink)

    console.log(`[WhatsApp] Tentativo di invio a ${order.customer_phone} per l'ordine ${order.order_number}...`)
    console.log(`[WhatsApp] Messaggio: "${messageText}"`)

    let responseOk = false
    let responseText = ''

    if (whatsapp_provider === 'evolution') {
      if (!whatsapp_api_url || !whatsapp_api_token || !whatsapp_instance_id) {
        throw new Error('Configurazione Evolution API incompleta (mancano URL, Token o Instance ID).')
      }

      // Evolution API sendText endpoint
      const baseUrl = whatsapp_api_url.trim().replace(/\/$/, '')
      const url = `${baseUrl}/message/sendText/${whatsapp_instance_id.trim()}`
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': whatsapp_api_token.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          number: order.customer_phone,
          text: messageText,
          options: {
            delay: 1200,
            presence: 'composing'
          }
        })
      })

      responseOk = response.ok
      responseText = await response.text()
    } else if (whatsapp_provider === 'custom') {
      if (!whatsapp_api_url) {
        throw new Error('URL dell\'API Custom mancante.')
      }

      const headers = {
        'Content-Type': 'application/json'
      }
      if (whatsapp_api_token) {
        headers['Authorization'] = `Bearer ${whatsapp_api_token.trim()}`
      }

      // Custom API endpoint
      const response = await fetch(whatsapp_api_url.trim(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: order.customer_phone,
          message: messageText
        })
      })

      responseOk = response.ok
      responseText = await response.text()
    } else {
      throw new Error(`Provider WhatsApp non supportato: ${whatsapp_provider}`)
    }

    if (responseOk) {
      console.log(`[WhatsApp] Messaggio inviato con successo a ${order.customer_phone}.`)
      await db.run(
        "UPDATE orders SET whatsapp_status = 'sent', status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [orderId]
      )
      return { success: true, response: responseText }
    } else {
      console.error(`[WhatsApp] Errore risposta API WhatsApp. Status: ${responseOk}. Risposta: ${responseText}`)
      await db.run(
        "UPDATE orders SET whatsapp_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [orderId]
      )
      return { success: false, error: responseText }
    }

  } catch (error) {
    console.error(`[WhatsApp] Errore durante l'invio per l'ordine ${orderId}:`, error.message)
    if (db) {
      await db.run(
        "UPDATE orders SET whatsapp_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [orderId]
      )
    }
    throw error
  }
}
