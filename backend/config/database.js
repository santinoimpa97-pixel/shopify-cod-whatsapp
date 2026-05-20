import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'
import { fileURLToPath } from 'url'
import pkg from 'pg'

const { Pool } = pkg

// Set type parser for INT8 (bigint) to return normal integers in pg
pkg.types.setTypeParser(pkg.types.builtins.INT8, (val) => parseInt(val, 10))

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = path.resolve(__dirname, '../database.sqlite')

let dbInstance = null

class PostgresWrapper {
  constructor(pool) {
    this.pool = pool
  }

  async get(sql, params = []) {
    const formattedSql = this.convertSql(sql)
    const res = await this.pool.query(formattedSql, params)
    return res.rows[0] || null
  }

  async all(sql, params = []) {
    const formattedSql = this.convertSql(sql)
    const res = await this.pool.query(formattedSql, params)
    return res.rows
  }

  async run(sql, params = []) {
    const formattedSql = this.convertSql(sql)
    const res = await this.pool.query(formattedSql, params)
    return {
      lastID: res.oid || null,
      changes: res.rowCount
    }
  }

  async exec(sql) {
    await this.pool.query(sql)
  }

  convertSql(sql) {
    let index = 1
    return sql.replace(/\?/g, () => `$${index++}`)
  }
}

export async function getDb() {
  if (dbInstance) return dbInstance

  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL || process.env.POSTGRES_URL

  if (dbUrl && (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://'))) {
    console.log('[Database] DATABASE_URL rilevata. Connessione a PostgreSQL in corso...')
    
    const poolConfig = {
      connectionString: dbUrl
    }

    // Abilita SSL se ci connettiamo a Neon/Render o siamo in produzione
    if (dbUrl.includes('neon.tech') || dbUrl.includes('render.com') || process.env.NODE_ENV === 'production') {
      poolConfig.ssl = {
        rejectUnauthorized: false
      }
    }

    const pool = new Pool(poolConfig)
    dbInstance = new PostgresWrapper(pool)

    // Creazione tabelle compatibili con PostgreSQL
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        shopify_store_url TEXT,
        shopify_client_id TEXT,
        shopify_client_secret TEXT,
        shopify_access_token TEXT,
        shopify_webhook_secret TEXT,
        app_url TEXT,
        whatsapp_provider TEXT DEFAULT 'manual',
        whatsapp_api_url TEXT,
        whatsapp_api_token TEXT,
        whatsapp_instance_id TEXT,
        whatsapp_template TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        shopify_order_id TEXT UNIQUE,
        order_number TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        total_price TEXT,
        currency TEXT,
        payment_gateway TEXT,
        status TEXT DEFAULT 'pending',
        whatsapp_status TEXT DEFAULT 'pending',
        token TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `)

    console.log('[Database] Connessione a PostgreSQL stabilita e tabelle verificate.')
  } else {
    console.log('[Database] Utilizzo database SQLite locale...')
    
    const sqliteDb = await open({
      filename: dbPath,
      driver: sqlite3.Database
    })

    // Enable foreign keys
    await sqliteDb.get('PRAGMA foreign_keys = ON')

    dbInstance = sqliteDb

    // Creazione tabelle compatibili con SQLite
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shopify_store_url TEXT,
        shopify_client_id TEXT,
        shopify_client_secret TEXT,
        shopify_access_token TEXT,
        shopify_webhook_secret TEXT,
        app_url TEXT,
        whatsapp_provider TEXT DEFAULT 'manual',
        whatsapp_api_url TEXT,
        whatsapp_api_token TEXT,
        whatsapp_instance_id TEXT,
        whatsapp_template TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        shopify_order_id TEXT UNIQUE,
        order_number TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        total_price TEXT,
        currency TEXT,
        payment_gateway TEXT,
        status TEXT DEFAULT 'pending',
        whatsapp_status TEXT DEFAULT 'pending',
        token TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)

    console.log('[Database] Connessione a SQLite stabilita e tabelle verificate.')
  }

  // Migrations (comuni a entrambi)
  try {
    await dbInstance.exec('ALTER TABLE settings ADD COLUMN shopify_client_id TEXT')
  } catch (err) {
    // Colonna già esistente, errore ignorato in sicurezza
  }
  try {
    await dbInstance.exec('ALTER TABLE settings ADD COLUMN shopify_client_secret TEXT')
  } catch (err) {
    // Colonna già esistente, errore ignorato in sicurezza
  }

  // Popolamento configurazioni predefinite
  const settingsCount = await dbInstance.get('SELECT COUNT(*) as count FROM settings')
  if (settingsCount.count === 0) {
    const defaultTemplate = 'Ciao {customer_name}, grazie per il tuo ordine #{order_number} di {order_total}. Clicca qui per confermare il tuo indirizzo e la spedizione: {confirm_link}'
    await dbInstance.run(
      'INSERT INTO settings (whatsapp_provider, whatsapp_template) VALUES (?, ?)',
      ['manual', defaultTemplate]
    )
  }

  return dbInstance
}
