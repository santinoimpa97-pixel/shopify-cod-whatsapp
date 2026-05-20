import express from 'express'
import { getDb } from '../config/database.js'
import { updateShopifyOrderTag } from '../services/shopify.js'

const router = express.Router()

router.get('/:token', async (req, res) => {
  const { token } = req.params

  try {
    const db = await getDb()
    
    // 1. Fetch order details from DB
    const order = await db.get('SELECT * FROM orders WHERE token = ?', [token])
    
    if (!order) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="it">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Ordine Non Trovato</title>
          <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Outfit', sans-serif;
              background-color: #0b0f19;
              color: #f8fafc;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              padding: 1.5rem;
              text-align: center;
              box-sizing: border-box;
            }
            .card {
              background: rgba(30, 41, 59, 0.4);
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255, 255, 255, 0.08);
              padding: 3rem 2rem;
              border-radius: 2rem;
              max-width: 420px;
              width: 100%;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            }
            h1 {
              color: #ef4444;
              margin-top: 0;
              font-size: 1.8rem;
            }
            p {
              color: #94a3b8;
              line-height: 1.6;
              font-size: 1rem;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Link non valido</h1>
            <p>Questo link di conferma ordine non è valido o è scaduto. Se ritieni sia un errore, ti invitiamo a contattare il nostro servizio clienti.</p>
          </div>
        </body>
        </html>
      `)
    }

    const alreadyConfirmed = order.status === 'confirmed'

    if (!alreadyConfirmed) {
      // 2. Update status in local SQLite DB
      await db.run(
        "UPDATE orders SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [order.id]
      )

      // 3. Update Shopify tags (Add 'cod confermato', Remove 'cod annullato')
      try {
        await updateShopifyOrderTag(order.shopify_order_id, 'cod confermato', 'cod annullato')
      } catch (shopifyErr) {
        console.error(`[Confirm Page] Errore aggiornamento tag Shopify per ordine ${order.order_number}:`, shopifyErr.message)
        // We proceed anyway since the local update was successful, but log the error
      }
    }

    // 4. Return custom premium HTML success page
    return res.send(`
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ordine Confermato</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Outfit', sans-serif;
            background: radial-gradient(circle at top, #0f1d30 0%, #070b13 100%);
            color: #f8fafc;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 1.5rem;
            box-sizing: border-box;
          }
          .card {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            padding: 3rem 2rem;
            border-radius: 2rem;
            width: 100%;
            max-width: 480px;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .icon-container {
            width: 88px;
            height: 88px;
            background: rgba(16, 185, 129, 0.08);
            border: 1.5px solid rgba(16, 185, 129, 0.25);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 0 auto 2rem;
            box-shadow: 0 0 30px rgba(16, 185, 129, 0.15);
            animation: pulse 2.5s infinite;
          }
          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.3); }
            70% { box-shadow: 0 0 0 15px rgba(16, 185, 129, 0); }
            100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          }
          .icon {
            color: #10b981;
            width: 44px;
            height: 44px;
            stroke-width: 2.5;
            animation: drawCheck 0.7s 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          @keyframes drawCheck {
            from { stroke-dashoffset: 50; }
            to { stroke-dashoffset: 0; }
          }
          h1 {
            font-size: 1.9rem;
            font-weight: 700;
            margin: 0 0 0.4rem 0;
            background: linear-gradient(135deg, #10b981 0%, #34d399 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .order-number {
            font-size: 1.1rem;
            color: #64748b;
            font-weight: 500;
            margin-bottom: 2rem;
            letter-spacing: 0.5px;
          }
          .divider {
            height: 1px;
            background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.08) 20%, rgba(255, 255, 255, 0.08) 80%, transparent);
            margin: 1.5rem 0;
          }
          .details-grid {
            display: grid;
            grid-template-columns: auto 1fr;
            row-gap: 0.8rem;
            column-gap: 1rem;
            text-align: left;
            margin-bottom: 2rem;
            background: rgba(255, 255, 255, 0.02);
            padding: 1.5rem;
            border-radius: 1.25rem;
            border: 1px solid rgba(255, 255, 255, 0.04);
          }
          .details-label {
            color: #64748b;
            font-size: 0.9rem;
            font-weight: 400;
          }
          .details-value {
            color: #f1f5f9;
            font-weight: 500;
            text-align: right;
            font-size: 0.95rem;
          }
          p.thankyou {
            color: #cbd5e1;
            font-size: 1.05rem;
            line-height: 1.6;
            margin: 0 0 2rem 0;
          }
          p.thankyou strong {
            color: #f1f5f9;
            font-weight: 600;
          }
          .footer-text {
            color: #475569;
            font-size: 0.8rem;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-container">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="50" stroke-dashoffset="0">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1>Ordine Confermato!</h1>
          <div class="order-number">Ordine #${order.order_number}</div>
          
          <p class="thankyou">Grazie <strong>${order.customer_name}</strong>, abbiamo registrato la tua conferma. Il tuo ordine è in fase di preparazione e sarà affidato al corriere a breve.</p>
          
          <div class="details-grid">
            <span class="details-label">Destinatario</span>
            <span class="details-value">${order.customer_name}</span>
            
            <span class="details-label">Importo da Pagare</span>
            <span class="details-value" style="color: #34d399; font-weight: 600; font-size: 1.05rem;">${order.total_price} ${order.currency}</span>
            
            <span class="details-label">Metodo di Pagamento</span>
            <span class="details-value">Contrassegno (alla consegna)</span>
          </div>
          
          <div class="divider"></div>
          <div class="footer-text">Puoi chiudere questa pagina. Riceverai gli aggiornamenti sulla spedizione direttamente sul tuo cellulare.</div>
        </div>
      </body>
      </html>
    `)

  } catch (error) {
    console.error('[Confirm Page] Errore gestione conferma:', error)
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Errore del Server</title>
        <style>
          body { font-family: sans-serif; background: #0b0f19; color: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2rem; border-radius: 1rem; text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Si è verificato un errore</h2>
          <p>Impossibile elaborare la conferma al momento. Riprova più tardi.</p>
        </div>
      </body>
      </html>
    `)
  }
})

export default router
