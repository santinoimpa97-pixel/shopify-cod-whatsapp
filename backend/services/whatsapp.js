import { getDb } from '../config/database.js'

/**
 * Sends a WhatsApp message for a given order, abandoned checkout, or draft order using the configured provider.
 * 
 * @param {string} id - Shopify object ID (Order, Checkout, or DraftOrder)
 * @param {string} type - Message type ('order', 'abandoned', 'draft')
 */
export async function sendWhatsAppMessage(id, type = 'order') {
  let db
  try {
    db = await getDb()
    
    // 1. Fetch settings
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
      whatsapp_template_abandoned,
      whatsapp_template_draft,
      app_url
    } = settings

    if (!whatsapp_provider || whatsapp_provider === 'manual') {
      console.log(`[WhatsApp] Provider impostato su "manual". Salto invio automatico per tipo: ${type}, id: ${id}.`)
      return { success: true, status: 'manual' }
    }

    const domain = app_url ? app_url.trim().replace(/\/$/, '') : 'http://localhost:5000'
    let recipientPhone = ''
    let messageText = ''
    let updateTable = ''
    let logIdentifier = ''

    if (type === 'order') {
      const order = await db.get('SELECT * FROM orders WHERE id = ?', [id])
      if (!order) {
        throw new Error(`Ordine ${id} non trovato nel database.`)
      }
      if (order.customer_phone === 'Nessun numero' || !order.customer_phone) {
        return { success: false, reason: 'Nessun telefono' }
      }
      recipientPhone = order.customer_phone
      updateTable = 'orders'
      logIdentifier = `Ordine #${order.order_number}`

      const confirmLink = `${domain}/confirm/${order.token}`
      messageText = whatsapp_template || ''
      messageText = messageText
        .replace(/{customer_name}/g, order.customer_name || 'Cliente')
        .replace(/{order_number}/g, order.order_number || '')
        .replace(/{order_total}/g, `${order.total_price} ${order.currency}`)
        .replace(/{confirm_link}/g, confirmLink)

    } else if (type === 'abandoned') {
      const checkout = await db.get('SELECT * FROM abandoned_checkouts WHERE id = ?', [id])
      if (!checkout) {
        throw new Error(`Carrello abbandonato ${id} non trovato nel database.`)
      }
      if (checkout.customer_phone === 'Nessun numero' || !checkout.customer_phone) {
        return { success: false, reason: 'Nessun telefono' }
      }
      recipientPhone = checkout.customer_phone
      updateTable = 'abandoned_checkouts'
      logIdentifier = `Checkout ${checkout.id}`

      const recoveryLink = `${domain}/recover-checkout/${checkout.token}`
      messageText = whatsapp_template_abandoned || ''
      messageText = messageText
        .replace(/{customer_name}/g, checkout.customer_name || 'Cliente')
        .replace(/{order_total}/g, `${checkout.total_price} ${checkout.currency}`)
        .replace(/{recovery_link}/g, recoveryLink)

    } else if (type === 'draft') {
      const draft = await db.get('SELECT * FROM draft_orders WHERE id = ?', [id])
      if (!draft) {
        throw new Error(`Bozza d'ordine ${id} non trovata nel database.`)
      }
      if (draft.customer_phone === 'Nessun numero' || !draft.customer_phone) {
        return { success: false, reason: 'Nessun telefono' }
      }
      recipientPhone = draft.customer_phone
      updateTable = 'draft_orders'
      logIdentifier = `Bozza ${draft.draft_order_number}`

      const invoiceLink = `${domain}/pay-draft/${draft.token}`
      messageText = whatsapp_template_draft || ''
      messageText = messageText
        .replace(/{customer_name}/g, draft.customer_name || 'Cliente')
        .replace(/{draft_number}/g, draft.draft_order_number || '')
        .replace(/{order_total}/g, `${draft.total_price} ${draft.currency}`)
        .replace(/{invoice_link}/g, invoiceLink)
    } else {
      throw new Error(`Tipo messaggio non supportato: ${type}`)
    }

    console.log(`[WhatsApp] Tentativo di invio automatico a ${recipientPhone} per ${logIdentifier}...`)
    console.log(`[WhatsApp] Messaggio: "${messageText}"`)

    let responseOk = false
    let responseText = ''

    if (whatsapp_provider === 'evolution') {
      if (!whatsapp_api_url || !whatsapp_api_token || !whatsapp_instance_id) {
        throw new Error('Configurazione Evolution API incompleta (mancano URL, Token o Instance ID).')
      }

      const baseUrl = whatsapp_api_url.trim().replace(/\/$/, '')
      const url = `${baseUrl}/message/sendText/${whatsapp_instance_id.trim()}`
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': whatsapp_api_token.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          number: recipientPhone,
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

      const response = await fetch(whatsapp_api_url.trim(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to: recipientPhone,
          message: messageText
        })
      })

      responseOk = response.ok
      responseText = await response.text()
    } else {
      throw new Error(`Provider WhatsApp non supportato: ${whatsapp_provider}`)
    }

    if (responseOk) {
      console.log(`[WhatsApp] Messaggio inviato con successo a ${recipientPhone}.`)
      if (updateTable === 'orders') {
        await db.run(
          "UPDATE orders SET whatsapp_status = 'sent', status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [id]
        )
      } else {
        await db.run(
          `UPDATE ${updateTable} SET whatsapp_status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [id]
        )
      }
      return { success: true, response: responseText }
    } else {
      console.error(`[WhatsApp] Errore risposta API WhatsApp. Status: ${responseOk}. Risposta: ${responseText}`)
      await db.run(
        `UPDATE ${updateTable} SET whatsapp_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      )
      return { success: false, error: responseText }
    }

  } catch (error) {
    console.error(`[WhatsApp] Errore durante l'invio per l'ordine ${id}:`, error.message)
    if (db) {
      const updateTable = type === 'order' ? 'orders' : (type === 'abandoned' ? 'abandoned_checkouts' : 'draft_orders')
      await db.run(
        `UPDATE ${updateTable} SET whatsapp_status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      )
    }
    throw error
  }
}
