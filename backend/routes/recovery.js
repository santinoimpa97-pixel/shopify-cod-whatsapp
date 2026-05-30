import express from 'express'
import { getDb } from '../config/database.js'

const router = express.Router()

// 1. Recover Abandoned Checkout Redirect
router.get('/recover-checkout/:token', async (req, res) => {
  const { token } = req.params

  try {
    const db = await getDb()
    
    // Fetch checkout by token
    const checkout = await db.get('SELECT * FROM abandoned_checkouts WHERE token = ?', [token])
    
    if (!checkout) {
      console.warn(`[Recovery Redirect] Token non valido o scaduto: ${token}`)
      return res.status(404).send('Link di recupero scaduto o non valido.')
    }

    console.log(`[Recovery Redirect] Recupero avviato per checkout ID: ${checkout.id}, Cliente: ${checkout.customer_name}`)

    // Update status to 'recovered' if it was pending or sent
    if (checkout.status === 'pending' || checkout.status === 'sent') {
      await db.run(
        "UPDATE abandoned_checkouts SET status = 'recovered', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [checkout.id]
      )
      console.log(`[Recovery Redirect] Stato impostato su "recovered" per checkout ${checkout.id}`)
    }

    // Redirect user to native Shopify checkout recovery URL
    if (checkout.abandoned_checkout_url) {
      return res.redirect(302, checkout.abandoned_checkout_url)
    } else {
      return res.status(400).send('URL di recupero non presente per questo checkout.')
    }
  } catch (error) {
    console.error('[Recovery Redirect] Errore:', error)
    return res.status(500).send('Errore interno del server.')
  }
})

// 2. Pay Draft Order Invoice Redirect
router.get('/pay-draft/:token', async (req, res) => {
  const { token } = req.params

  try {
    const db = await getDb()
    
    // Fetch draft order by token
    const draft = await db.get('SELECT * FROM draft_orders WHERE token = ?', [token])
    
    if (!draft) {
      console.warn(`[Pay Draft Redirect] Token non valido o scaduto: ${token}`)
      return res.status(404).send('Link di pagamento scaduto o non valido.')
    }

    console.log(`[Pay Draft Redirect] Pagamento avviato per bozza: ${draft.draft_order_number}, Cliente: ${draft.customer_name}`)

    // Update status to 'invoice_sent' (as they clicked) if it's open
    if (draft.status === 'open') {
      await db.run(
        "UPDATE draft_orders SET status = 'invoice_sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [draft.id]
      )
    }

    // Redirect user to Shopify invoice checkout page
    if (draft.invoice_url) {
      return res.redirect(302, draft.invoice_url)
    } else {
      return res.status(400).send('URL fattura non presente per questa bozza d\'ordine.')
    }
  } catch (error) {
    console.error('[Pay Draft Redirect] Errore:', error)
    return res.status(500).send('Errore interno del server.')
  }
})

export default router
