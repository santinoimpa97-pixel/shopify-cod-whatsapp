import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb } from './config/database.js'

import webhookRouter from './routes/webhooks.js'
import apiRouter from './routes/api.js'
import confirmRouter from './routes/confirm.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 5000

// Configure CORS
app.use(cors())

// Capture raw body for Shopify webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

app.use(express.urlencoded({ extended: true }))

// Initialize SQLite DB on startup
getDb()
  .then(() => console.log('[Server] Database SQLite agganciato e pronto.'))
  .catch((err) => {
    console.error('[Server] Impossibile avviare il database SQLite:', err)
    process.exit(1)
  })

// Mount API and Webhook Routers
app.use('/webhooks', webhookRouter)
app.use('/api', apiRouter)
app.use('/confirm', confirmRouter)

// Serve Static React assets in production
const frontendDistPath = path.resolve(__dirname, '../frontend/dist')
app.use(express.static(frontendDistPath))

// Fallback to index.html for React SPA Router
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhooks') || req.path.startsWith('/confirm')) {
    return next()
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
    if (err) {
      // In development or before building the frontend, this file won't exist.
      res.status(200).send('Backend attivo. Il frontend non è stato ancora compilato in production (usa "npm run dev" in sviluppo).')
    }
  })
})

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`)
  console.log(`🚀 SERVIZIO COD CONFIRMATION ATTIVO!`)
  console.log(`💻 Server in esecuzione su: http://localhost:${PORT}`)
  console.log(`🔗 Webhook Shopify: http://localhost:${PORT}/webhooks/shopify/orders-create`)
  console.log(`🔗 Link di conferma clienti: http://localhost:${PORT}/confirm/:token`)
  console.log(`======================================================\n`)
})
