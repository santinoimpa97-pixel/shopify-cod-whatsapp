import React, { useState, useEffect } from 'react'
import { 
  MessageSquare, 
  Settings, 
  RefreshCw, 
  Check, 
  X, 
  Search, 
  ShoppingBag, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  AlertTriangle, 
  ExternalLink, 
  Save, 
  Database, 
  Smartphone, 
  Send 
} from 'lucide-react'

function App() {
  const [activeTab, setActiveTab] = useState('orders')
  const [orders, setOrders] = useState([])
  const [stats, setStats] = useState({
    total: 0,
    confirmed: 0,
    pending: 0,
    sent: 0,
    cancelled: 0,
    failed: 0,
    conversionRate: 0
  })
  const [settings, setSettings] = useState({
    shopify_store_url: '',
    shopify_client_id: '',
    shopify_client_secret: '',
    shopify_access_token: '',
    shopify_webhook_secret: '',
    app_url: '',
    whatsapp_provider: 'manual',
    whatsapp_api_url: '',
    whatsapp_api_token: '',
    whatsapp_instance_id: '',
    whatsapp_template: ''
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingStats, setLoadingStats] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [syncingOrders, setSyncingOrders] = useState(false)
  const [alert, setAlert] = useState(null)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [totalOrders, setTotalOrders] = useState(0)
  const limit = 15

  // Trigger auto-dismiss alert
  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => setAlert(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alert])

  // Fetch initial data
  useEffect(() => {
    fetchSettings()
    fetchStats()

    // Check if redirecting from successful OAuth
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'success') {
      showAlert('success', 'Collegamento a Shopify completato con successo!')
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  // Fetch orders when filter, search, or page changes
  useEffect(() => {
    fetchOrders()
  }, [searchQuery, statusFilter, page])

  const fetchSettings = async () => {
    setLoadingSettings(true)
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        setSettings(prev => {
          const updated = { ...prev, ...data }
          if (!updated.app_url) {
            updated.app_url = window.location.origin
          }
          return updated
        })
      } else {
        showAlert('error', 'Impossibile caricare le impostazioni.')
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Errore di connessione al server per le impostazioni.')
    } finally {
      setLoadingSettings(false)
    }
  }

  const fetchStats = async () => {
    setLoadingStats(true)
    try {
      const res = await fetch('/api/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingStats(false)
    }
  }

  const fetchOrders = async () => {
    setLoadingOrders(true)
    try {
      const offset = (page - 1) * limit
      const url = `/api/orders?search=${encodeURIComponent(searchQuery)}&status=${statusFilter}&limit=${limit}&offset=${offset}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setOrders(data.orders)
        setTotalOrders(data.total)
      } else {
        showAlert('error', 'Errore durante il caricamento degli ordini.')
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Impossibile connettersi al backend.')
    } finally {
      setLoadingOrders(false)
    }
  }

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault()
    setSavingSettings(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      if (res.ok) {
        showAlert('success', 'Impostazioni salvate con successo!')
        fetchStats() // Update stats if URL template changed
        return true
      } else {
        showAlert('error', 'Errore durante il salvataggio delle impostazioni.')
        return false
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Errore di connessione durante il salvataggio.')
      return false
    } finally {
      setSavingSettings(false)
    }
  }

  const handleConnectShopify = async () => {
    if (!settings.shopify_store_url || !settings.shopify_client_id || !settings.shopify_client_secret || !settings.app_url) {
      showAlert('error', 'Inserisci Dominio Negozio, Client ID, Client Secret e URL App dell\'App, e salvali prima di connetterti.')
      return
    }
    
    // Auto-save first
    const saved = await handleSaveSettings()
    if (saved) {
      const cleanShop = settings.shopify_store_url.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()
      window.location.href = `/api/shopify/auth?shop=${encodeURIComponent(cleanShop)}`
    }
  }

  const handleSyncOrders = async () => {
    setSyncingOrders(true)
    try {
      const res = await fetch('/api/shopify/sync', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        showAlert('success', data.message)
        fetchOrders()
        fetchStats()
      } else {
        showAlert('error', data.error || 'Errore durante la sincronizzazione degli ordini.')
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Errore di connessione durante la sincronizzazione.')
    } finally {
      setSyncingOrders(false)
    }
  }

  const handleResendWhatsApp = async (orderId) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/resend-whatsapp`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        showAlert('success', 'Messaggio inviato correttamente via WhatsApp API!')
        fetchOrders()
        fetchStats()
      } else {
        showAlert('error', `Invio fallito: ${data.error || 'Errore sconosciuto'}`)
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Errore di connessione durante l\'invio.')
    }
  }

  const handleConfirmOrder = async (orderId) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        showAlert('success', data.message)
        fetchOrders()
        fetchStats()
      } else {
        showAlert('error', `Conferma fallita: ${data.error || 'Errore sconosciuto'}`)
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Errore di connessione.')
    }
  }

  const handleCancelOrder = async (orderId) => {
    if (!window.confirm('Sei sicuro di voler annullare questo ordine? Verrà applicato il tag di annullamento.')) return
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        showAlert('success', data.message)
        fetchOrders()
        fetchStats()
      } else {
        showAlert('error', `Annullamento fallito: ${data.error || 'Errore'}`)
      }
    } catch (err) {
      console.error(err)
      showAlert('error', 'Errore di connessione.')
    }
  }

  const showAlert = (type, message) => {
    setAlert({ type, message })
  }

  // Generates link for wa.me manual flow
  const getManualWhatsAppLink = (order) => {
    const phone = order.customer_phone
    const domain = settings.app_url || window.location.origin
    const confirmLink = `${domain.trim().replace(/\/$/, '')}/confirm/${order.token}`
    
    let text = settings.whatsapp_template || ''
    text = text
      .replace(/{customer_name}/g, order.customer_name)
      .replace(/{order_number}/g, order.order_number)
      .replace(/{order_total}/g, `${order.total_price} ${order.currency}`)
      .replace(/{confirm_link}/g, confirmLink)

    return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`
  }

  // Helper for template preview
  const getTemplatePreview = () => {
    const testOrder = {
      customer_name: 'Mario Rossi',
      order_number: '1024',
      total_price: '45.00',
      currency: 'EUR',
      token: 'test-token-123'
    }
    const domain = settings.app_url || window.location.origin
    const confirmLink = `${domain.trim().replace(/\/$/, '')}/confirm/${testOrder.token}`
    
    let text = settings.whatsapp_template || 'Nessun modello configurato.'
    return text
      .replace(/{customer_name}/g, testOrder.customer_name)
      .replace(/{order_number}/g, testOrder.order_number)
      .replace(/{order_total}/g, `${testOrder.total_price} ${testOrder.currency}`)
      .replace(/{confirm_link}/g, confirmLink)
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'confirmed':
        return <span className="badge confirmed"><CheckCircle2 size={12} /> Confermato</span>
      case 'cancelled':
        return <span className="badge cancelled"><XCircle size={12} /> Annullato</span>
      case 'sent':
        return <span className="badge sent"><Send size={12} /> Inviato</span>
      case 'failed':
        return <span className="badge failed"><AlertTriangle size={12} /> Errore</span>
      case 'pending':
      default:
        return <span className="badge pending"><Clock size={12} /> Pendente</span>
    }
  }

  const totalPages = Math.ceil(totalOrders / limit)

  return (
    <div className="app-container">
      {/* Header */}
      <header>
        <div className="logo-section">
          <MessageSquare className="logo-icon" />
          <div>
            <h1>COD WhatsApp Manager</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Automazione per Shopify Contrassegno</p>
          </div>
          <span>v1.0.0</span>
        </div>
        
        <div className="nav-tabs">
          <button 
            className={`tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <ShoppingBag size={16} /> Ordini COD
          </button>
          <button 
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} /> Impostazioni
          </button>
        </div>
      </header>

      {/* Global Alert Notification */}
      {alert && (
        <div className={`alert alert-${alert.type}`}>
          {alert.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{alert.message}</span>
        </div>
      )}

      {/* Main Content View */}
      {activeTab === 'orders' ? (
        <>
          {/* Stats Bar */}
          <div className="stats-grid">
            <div className="glass-card stat-card">
              <div className="stat-icon-wrapper info">
                <ShoppingBag size={24} />
              </div>
              <div className="stat-info">
                <span className="stat-label">Ordini COD Totali</span>
                <span className="stat-value">{stats.total}</span>
              </div>
            </div>
            
            <div className="glass-card stat-card">
              <div className="stat-icon-wrapper primary">
                <CheckCircle2 size={24} />
              </div>
              <div className="stat-info">
                <span className="stat-label">Ordini Confermati</span>
                <span className="stat-value">{stats.confirmed}</span>
              </div>
            </div>

            <div className="glass-card stat-card">
              <div className="stat-icon-wrapper warning">
                <Clock size={24} />
              </div>
              <div className="stat-info">
                <span className="stat-label">In Attesa / Pendenti</span>
                <span className="stat-value">{stats.pending + stats.sent}</span>
              </div>
            </div>

            <div className="glass-card stat-card">
              <div className="stat-icon-wrapper success">
                <Check size={24} style={{ strokeWidth: 3 }} />
              </div>
              <div className="stat-info">
                <span className="stat-label">Tasso di Riconversione</span>
                <span className="stat-value">{stats.conversionRate}%</span>
              </div>
            </div>
          </div>

          {/* Orders Section */}
          <div className="glass-card">
            {/* Filter and Search controls */}
            <div className="filter-bar">
              <div className="search-wrapper">
                <Search className="search-icon" />
                <input 
                  type="text" 
                  className="input-search"
                  placeholder="Cerca per numero ordine, cliente o telefono..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                />
              </div>

              <div className="filter-selectors">
                <select 
                  className="select-filter"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                >
                  <option value="all">Tutti gli stati</option>
                  <option value="pending">Pendente (Nuovo)</option>
                  <option value="sent">Inviato WhatsApp</option>
                  <option value="confirmed">Confermato</option>
                  <option value="cancelled">Annullato</option>
                  <option value="failed">Errore di invio</option>
                </select>

                <button 
                  className="btn btn-secondary btn-icon-only"
                  onClick={() => { fetchOrders(); fetchStats(); }}
                  title="Rinfresca dati"
                  disabled={syncingOrders}
                >
                  <RefreshCw size={16} className={(loadingOrders || loadingStats) ? 'animate-spin' : ''} />
                </button>

                <button 
                  className="btn btn-primary"
                  onClick={handleSyncOrders}
                  title="Importa gli ultimi ordini COD da Shopify"
                  disabled={syncingOrders}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.5rem', background: 'var(--primary)' }}
                >
                  <RefreshCw size={14} className={syncingOrders ? 'animate-spin' : ''} />
                  {syncingOrders ? 'Sincronizzazione...' : 'Sincronizza da Shopify'}
                </button>
              </div>
            </div>

            {/* Orders Table */}
            {loadingOrders ? (
              <div style={{ padding: '2rem 0' }}>
                <div className="skeleton-line" style={{ marginBottom: '1rem', height: '2.5rem' }}></div>
                <div className="skeleton-line" style={{ marginBottom: '0.75rem' }}></div>
                <div className="skeleton-line" style={{ marginBottom: '0.75rem' }}></div>
                <div className="skeleton-line" style={{ marginBottom: '0.75rem' }}></div>
                <div className="skeleton-line" style={{ marginBottom: '0.75rem' }}></div>
              </div>
            ) : orders.length === 0 ? (
              <div className="empty-state">
                <ShoppingBag className="empty-state-icon" />
                <h3>Nessun ordine trovato</h3>
                <p>Nessun ordine COD corrisponde ai criteri di ricerca impostati.</p>
              </div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Ordine</th>
                        <th>Data Ricezione</th>
                        <th>Cliente</th>
                        <th>Telefono</th>
                        <th>Totale</th>
                        <th>Stato</th>
                        <th style={{ textAlign: 'right' }}>Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr key={order.id}>
                          <td style={{ fontWeight: 600 }}>#{order.order_number}</td>
                          <td style={{ color: 'var(--text-muted)' }}>
                            {new Date(order.created_at).toLocaleString('it-IT', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                          <td>{order.customer_name}</td>
                          <td style={{ fontFamily: 'monospace' }}>{order.customer_phone}</td>
                          <td style={{ fontWeight: 600 }}>{order.total_price} {order.currency}</td>
                          <td>{getStatusBadge(order.status)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="actions-cell" style={{ justifyContent: 'flex-end' }}>
                              {/* Action: Send Manual/Automatic WhatsApp */}
                              {settings.whatsapp_provider === 'manual' ? (
                                <a 
                                  href={getManualWhatsAppLink(order)} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="btn btn-secondary btn-icon-only"
                                  title="Invia WhatsApp Manuale (wa.me)"
                                >
                                  <Smartphone size={15} style={{ color: '#25D366' }} />
                                </a>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleResendWhatsApp(order.id)}
                                    className="btn btn-secondary btn-icon-only"
                                    title="Invia/Reinvia messaggio automatico"
                                    disabled={order.customer_phone === 'Nessun numero'}
                                  >
                                    <Send size={15} style={{ color: 'var(--primary)' }} />
                                  </button>
                                  <a 
                                    href={getManualWhatsAppLink(order)} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary btn-icon-only"
                                    title="Fallback Manuale (wa.me)"
                                  >
                                    <Smartphone size={15} style={{ color: 'var(--text-muted)' }} />
                                  </a>
                                </>
                              )}

                              {/* Action: Confirm Manually */}
                              <button
                                onClick={() => handleConfirmOrder(order.id)}
                                className="btn btn-success btn-icon-only"
                                title="Conferma Ordine (Aggiunge tag)"
                                disabled={order.status === 'confirmed'}
                              >
                                <Check size={15} />
                              </button>

                              {/* Action: Cancel Order */}
                              <button
                                onClick={() => handleCancelOrder(order.id)}
                                className="btn btn-danger btn-icon-only"
                                title="Annulla Ordine (Aggiunge tag annullato)"
                                disabled={order.status === 'cancelled'}
                              >
                                <X size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination footer */}
                {totalPages > 1 && (
                  <div className="pagination">
                    <span>
                      Pagina {page} di {totalPages} ({totalOrders} ordini totali)
                    </span>
                    <div className="pagination-controls">
                      <button 
                        className="btn btn-secondary" 
                        disabled={page === 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                      >
                        Precedente
                      </button>
                      <button 
                        className="btn btn-secondary" 
                        disabled={page === totalPages}
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      >
                        Successiva
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        /* Settings Section */
        <form onSubmit={handleSaveSettings} className="settings-grid">
          {/* Settings Fields */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Shopify Config */}
            <div>
              <h3 className="settings-section-title">
                <Database size={18} style={{ color: 'var(--primary)' }} /> Integrazione Shopify (OAuth)
              </h3>
              
              <div className="form-group">
                <label>Dominio Negozio Shopify (.myshopify.com)</label>
                <input 
                  type="text" 
                  className="form-control"
                  placeholder="esempio-negozio.myshopify.com"
                  required
                  value={settings.shopify_store_url || ''}
                  onChange={(e) => setSettings({ ...settings, shopify_store_url: e.target.value })}
                />
                <span className="form-help">Inserisci l'URL del tuo negozio Shopify (es. nome-negozio.myshopify.com)</span>
              </div>

              <div className="form-group">
                <label>Client ID (Chiave API dell'App)</label>
                <input 
                  type="text" 
                  className="form-control"
                  placeholder="Inserisci il Client ID dell'app da Shopify Dev"
                  required
                  value={settings.shopify_client_id || ''}
                  onChange={(e) => setSettings({ ...settings, shopify_client_id: e.target.value })}
                />
                <span className="form-help">Fornito nella schermata dell'app su Shopify Dev {`->`} Credenziali API.</span>
              </div>

              <div className="form-group">
                <label>Client Secret (Chiave segreta API dell'App)</label>
                <input 
                  type="password" 
                  className="form-control"
                  placeholder="Inserisci la chiave segreta dell'app"
                  required
                  value={settings.shopify_client_secret || ''}
                  onChange={(e) => setSettings({ ...settings, shopify_client_secret: e.target.value })}
                />
                <span className="form-help">Fornito nella schermata dell'app su Shopify Dev {`->`} Credenziali API.</span>
              </div>

              <div className="form-group">
                <label>Stato Collegamento Shopify</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                  {settings.shopify_access_token ? (
                    <span className="badge confirmed" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                      <Check size={16} /> Collegato a Shopify ✔
                    </span>
                  ) : (
                    <span className="badge failed" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                      <X size={16} /> Non collegato a Shopify
                    </span>
                  )}
                  
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleConnectShopify}
                    style={{ background: 'var(--secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                  >
                    <RefreshCw size={14} /> Effettua Collegamento (OAuth)
                  </button>
                </div>
                <span className="form-help" style={{ marginTop: '0.5rem', display: 'block' }}>
                  Nota: per connetterti, devi prima aver impostato l'<b>URL Pubblico dell'Applicazione</b> qui sotto ed aver configurato i Redirect URI in Shopify Dev.
                </span>
              </div>

              <div className="form-group">
                <label>Webhook Secret Key (Opzionale)</label>
                <input 
                  type="password" 
                  className="form-control"
                  placeholder="Chiave segreta per validazione firma"
                  value={settings.shopify_webhook_secret || ''}
                  onChange={(e) => setSettings({ ...settings, shopify_webhook_secret: e.target.value })}
                />
                <span className="form-help">Fornito da Shopify alla creazione del webhook `orders/create`. Lascia vuoto per disabilitare la verifica della firma in sviluppo.</span>
              </div>
            </div>

            {/* App Domain Config */}
            <div>
              <h3 className="settings-section-title">
                <ExternalLink size={18} style={{ color: 'var(--secondary)' }} /> Link di Conferma
              </h3>
              
              <div className="form-group">
                <label>URL Pubblico dell'Applicazione (per link WhatsApp)</label>
                <input 
                  type="url" 
                  className="form-control"
                  placeholder="https://tua-app-shopify.up.railway.app"
                  value={settings.app_url}
                  onChange={(e) => setSettings({ ...settings, app_url: e.target.value })}
                />
                <span className="form-help">Indirizzo pubblico dove risiede questo server (es. ngrok o deploy su Railway). Verrà usato nel link inviato al cliente.</span>
              </div>
            </div>

            {/* WhatsApp Integration Config */}
            <div>
              <h3 className="settings-section-title">
                <Smartphone size={18} style={{ color: '#25D366' }} /> Servizio WhatsApp
              </h3>

              <div className="form-group">
                <label>Provider API WhatsApp</label>
                <select 
                  className="form-control"
                  value={settings.whatsapp_provider}
                  onChange={(e) => setSettings({ ...settings, whatsapp_provider: e.target.value })}
                >
                  <option value="manual">Manuale (Pulsante Link wa.me - Gratuito)</option>
                  <option value="evolution">Evolution API (QR Code / Scansione account)</option>
                  <option value="custom">Custom Webhook API (Invio POST JSON a URL)</option>
                </select>
                <span className="form-help">Scegli come inviare i messaggi: in modalità manuale usi un pulsante wa.me, con Evolution API l'invio è automatico al 100%.</span>
              </div>

              {settings.whatsapp_provider !== 'manual' && (
                <>
                  <div className="form-group">
                    <label>URL Base API</label>
                    <input 
                      type="url" 
                      className="form-control"
                      placeholder={settings.whatsapp_provider === 'evolution' ? 'https://mio-server-evolution.com' : 'https://api-custom.com/webhook'}
                      required
                      value={settings.whatsapp_api_url}
                      onChange={(e) => setSettings({ ...settings, whatsapp_api_url: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Chiave API (Token / apikey)</label>
                    <input 
                      type="password" 
                      className="form-control"
                      placeholder="Inserisci la chiave di autorizzazione"
                      value={settings.whatsapp_api_token}
                      onChange={(e) => setSettings({ ...settings, whatsapp_api_token: e.target.value })}
                    />
                  </div>

                  {settings.whatsapp_provider === 'evolution' && (
                    <div className="form-group">
                      <label>Nome Istanza (Evolution API Instance)</label>
                      <input 
                        type="text" 
                        className="form-control"
                        placeholder="es. MainInstance"
                        required={settings.whatsapp_provider === 'evolution'}
                        value={settings.whatsapp_instance_id}
                        onChange={(e) => setSettings({ ...settings, whatsapp_instance_id: e.target.value })}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Message Template Editor Panel */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <h3 className="settings-section-title">
                <MessageSquare size={18} style={{ color: 'var(--primary)' }} /> Modello Messaggio WhatsApp
              </h3>

              <div className="form-group">
                <label>Testo del Messaggio</label>
                <textarea 
                  className="form-control"
                  rows={6}
                  required
                  value={settings.whatsapp_template}
                  onChange={(e) => setSettings({ ...settings, whatsapp_template: e.target.value })}
                  placeholder="Scrivi il messaggio..."
                />
                
                <span className="form-help">Puoi inserire le seguenti variabili dinamiche che verranno sostituite automaticamente:</span>
                <div className="variables-list">
                  <span className="variable-badge" onClick={() => setSettings(s => ({ ...s, whatsapp_template: s.whatsapp_template + '{customer_name}' }))}>{`{customer_name}`}</span>
                  <span className="variable-badge" onClick={() => setSettings(s => ({ ...s, whatsapp_template: s.whatsapp_template + '{order_number}' }))}>{`{order_number}`}</span>
                  <span className="variable-badge" onClick={() => setSettings(s => ({ ...s, whatsapp_template: s.whatsapp_template + '{order_total}' }))}>{`{order_total}`}</span>
                  <span className="variable-badge" onClick={() => setSettings(s => ({ ...s, whatsapp_template: s.whatsapp_template + '{confirm_link}' }))}>{`{confirm_link}`}</span>
                </div>
              </div>

              {/* Preview Box */}
              <div style={{ marginTop: '2rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem' }}>Anteprima Visiva Messaggio WhatsApp</label>
                <div 
                  style={{
                    background: '#0b141a',
                    backgroundImage: 'radial-gradient(#128c7e 0.5px, transparent 0.5px), radial-gradient(#128c7e 0.5px, #0b141a 0.5px)',
                    backgroundSize: '20px 20px',
                    backgroundPosition: '0 0, 10px 10px',
                    borderRadius: '1.25rem',
                    padding: '1.5rem',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    position: 'relative'
                  }}
                >
                  <div 
                    style={{
                      background: '#075e54',
                      color: 'white',
                      padding: '0.6rem 1rem',
                      borderRadius: '0.75rem 0.75rem 0 0.75rem',
                      maxWidth: '85%',
                      marginLeft: 'auto',
                      fontSize: '0.9rem',
                      lineHeight: '1.4',
                      whiteSpace: 'pre-wrap',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                      borderRight: '4px solid #128c7e'
                    }}
                  >
                    {getTemplatePreview()}
                    <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.4rem' }}>
                      10:24 ✔✔
                    </div>
                  </div>
                </div>
              </div>

              {settings.whatsapp_provider === 'manual' && (
                <div className="manual-send-info">
                  <strong>💡 Modalità Manuale:</strong> Premendo l'icona del telefono verde nella lista ordini, si aprirà una scheda di WhatsApp Web con il messaggio qui sopra precompilato pronto per essere inviato manualmente premendo Invio. Il link `{`{confirm_link}`}` consentirà comunque la conferma automatica quando cliccato dal cliente!
                </div>
              )}
            </div>

            <div className="actions-footer">
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={fetchSettings}
                disabled={loadingSettings || savingSettings}
              >
                Annulla modifiche
              </button>
              
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={savingSettings}
              >
                <Save size={16} /> {savingSettings ? 'Salvataggio...' : 'Salva Impostazioni'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

export default App
