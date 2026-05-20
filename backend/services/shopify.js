import { getDb } from '../config/database.js'

/**
 * Normalizes the Shopify store URL to ensure it is just the hostname.
 * e.g., "https://my-store.myshopify.com/" -> "my-store.myshopify.com"
 */
const cleanStoreUrl = (url) => {
  if (!url) return ''
  let clean = url.trim()
  clean = clean.replace(/^https?:\/\//, '')
  clean = clean.replace(/\/$/, '')
  return clean
}

/**
 * Updates an order's tags on Shopify.
 * 
 * @param {string} orderId - Shopify Order ID
 * @param {string} tagToAdd - Tag to add to the order
 * @param {string} [tagToRemove] - Optional tag to remove from the order
 */
export async function updateShopifyOrderTag(orderId, tagToAdd, tagToRemove = null) {
  try {
    const db = await getDb()
    const settings = await db.get('SELECT shopify_store_url, shopify_access_token FROM settings ORDER BY id DESC LIMIT 1')

    if (!settings || !settings.shopify_store_url || !settings.shopify_access_token) {
      throw new Error('Credenziali Shopify non configurate nelle impostazioni.')
    }

    const storeUrl = cleanStoreUrl(settings.shopify_store_url)
    const token = settings.shopify_access_token.trim()

    // 1. Fetch the current order to get existing tags
    const fetchUrl = `https://${storeUrl}/admin/api/2024-04/orders/${orderId}.json`
    console.log(`[Shopify API] Recupero dell'ordine ${orderId} da Shopify...`)
    
    const fetchResponse = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      }
    })

    if (!fetchResponse.ok) {
      const errText = await fetchResponse.text()
      throw new Error(`Impossibile recuperare l'ordine da Shopify: Status ${fetchResponse.status} - ${errText}`)
    }

    const data = await fetchResponse.json()
    if (!data.order) {
      throw new Error(`Ordine ${orderId} non trovato su Shopify`)
    }

    const order = data.order
    
    // Parse existing tags
    let currentTags = order.tags 
      ? order.tags.split(',').map(t => t.trim()).filter(Boolean)
      : []

    console.log(`[Shopify API] Tag attuali per l'ordine ${orderId}:`, currentTags)

    // Modify tags
    let modified = false

    if (tagToRemove) {
      const normalizedToRemove = tagToRemove.toLowerCase()
      const originalLength = currentTags.length
      currentTags = currentTags.filter(t => t.toLowerCase() !== normalizedToRemove)
      if (currentTags.length !== originalLength) {
        modified = true
      }
    }
    
    if (tagToAdd) {
      const normalizedToAdd = tagToAdd.toLowerCase()
      if (!currentTags.some(t => t.toLowerCase() === normalizedToAdd)) {
        currentTags.push(tagToAdd)
        modified = true
      }
    }

    if (!modified) {
      console.log(`[Shopify API] Nessuna modifica dei tag necessaria per l'ordine ${orderId}.`)
      return order
    }

    const updatedTagsString = currentTags.join(', ')
    console.log(`[Shopify API] Aggiornamento dei tag per l'ordine ${orderId} a: "${updatedTagsString}"`)

    // 2. Push the updated tags back to Shopify
    const updateResponse = await fetch(fetchUrl, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order: {
          id: parseInt(orderId, 10),
          tags: updatedTagsString
        }
      })
    })

    if (!updateResponse.ok) {
      const errText = await updateResponse.text()
      throw new Error(`Impossibile aggiornare i tag dell'ordine su Shopify: Status ${updateResponse.status} - ${errText}`)
    }

    const updatedData = await updateResponse.json()
    console.log(`[Shopify API] Ordine ${orderId} taggato con successo su Shopify.`)
    return updatedData.order
  } catch (error) {
    console.error(`[Shopify API] Errore in updateShopifyOrderTag per l'ordine ${orderId}:`, error.message)
    throw error
  }
}
