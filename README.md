# Shopify COD & WhatsApp Confirmation App

Questa applicazione automatizza la conferma degli ordini in contrassegno (COD - Cash on Delivery) su Shopify tramite messaggi WhatsApp e l'aggiornamento automatico dei tag su Shopify.

## Come Funziona
1. **Webhook Shopify**: Quando viene effettuato un nuovo ordine COD su Shopify, la piattaforma invia un webhook (`orders/create`) a questa app.
2. **WhatsApp Automatico / Manuale**: L'app registra l'ordine nel database SQLite locale come "Pendente" ed invia un messaggio WhatsApp al cliente (automaticamente tramite Evolution API/Custom API, o con un pulsante rapido wa.me in modalità manuale).
3. **Link di Conferma (Click-to-Confirm)**: Il messaggio contiene un link univoco per il cliente (es. `https://tua-app.com/confirm/token-univoco`).
4. **Tagging Automatico**: Cliccando sul link, si apre una pagina di conferma dal design premium. L'app aggiorna lo stato dell'ordine e aggiunge automaticamente il tag `cod confermato` (rimuovendo `cod annullato`) su Shopify tramite le API Admin.

---

## 🛠️ Requisiti di Installazione e Avvio Rapido

### 1. Installazione delle Dipendenze
La struttura è configurata come monorepo. Puoi installare tutte le dipendenze (root, backend e frontend) con un singolo comando:
```bash
npm run setup
```

### 2. Esecuzione in Sviluppo
Per avviare sia il backend (porta 5000) che il frontend React (porta 3000 con proxy API attivo) contemporaneamente:
```bash
npm run dev
```
Apri il tuo browser su `http://localhost:3000` per accedere alla dashboard.

### 3. Esecuzione in Produzione / Compilazione
Per compilare il frontend ed avviare il server Express unificato (che servirà sia le API che la dashboard sulla porta 5000):
```bash
npm run build
npm start
```
Apri il tuo browser su `http://localhost:5000` per accedere alla dashboard unificata.

---

## ⚙️ Configurazione dei Servizi Esterni

Accedi alla scheda **Impostazioni** nella dashboard dell'applicazione per configurare le integrazioni:

### A. Setup su Shopify (Tramite Shopify Dev Dashboard - OAuth)
Dato che Shopify ha disattivato la creazione di token manuali (legacy custom apps) nel 2026, la connessione avviene in modalità OAuth sicura tramite il tuo pannello sviluppatore:
1. Accedi a [Shopify Dev Dashboard](https://partners.shopify.com/) (o crea un account partner gratuito se non lo possiedi).
2. Clicca su **App** nel menu a sinistra e poi su **Crea app** in alto a destra.
3. Seleziona **Crea un'app manualmente**.
4. Inserisci il nome (es: `COD WhatsApp Confirmation`) e clicca su **Crea**.
5. Nella scheda dell'app appena creata, sotto **Configurazione**, imposta:
   - **URL app**: L'URL pubblico della tua app (es. il tuo indirizzo ngrok o il link di Railway).
   - **Allowed redirection URL** (URL di reindirizzamento consentiti): L'URL della tua app seguito da `/api/shopify/auth/callback` (es. `https://tua-app.up.railway.app/api/shopify/auth/callback` o `https://tuo-ngrok.ngrok-free.app/api/shopify/auth/callback`).
6. Clicca su **Salva**.
7. Vai nella sezione **Credenziali API** del pannello sviluppatore di Shopify e copia:
   - **Client ID** (Chiave API)
   - **Client Secret** (Chiave segreta API)
8. Incolla questi valori (insieme all'URL pubblico dell'App e al dominio del tuo negozio `tuonegazio.myshopify.com`) nella scheda **Impostazioni** della dashboard ed effettua il salvataggio.
9. Clicca sul pulsante **Effettua Collegamento (OAuth)**: verrai reindirizzato su Shopify per autorizzare l'installazione sul tuo negozio. Fatto questo, l'applicazione sarà connessa e riceverà l'access token in background automaticamente!

### B. Configurazione del Webhook su Shopify
Per ricevere gli ordini in tempo reale:
1. Nelle impostazioni di Shopify, vai su **Notifiche** > **Webhook** (scorri in fondo).
2. Clicca su **Crea webhook**.
3. Configura come segue:
   - **Evento**: Creazione ordine (`orders/create`)
   - **Formato**: JSON
   - **URL**: L'indirizzo pubblico della tua app seguito da `/webhooks/shopify/orders-create` (es. `https://tua-app.up.railway.app/webhooks/shopify/orders-create` o il tuo indirizzo ngrok in locale).
   - **Versione API dell'Admin**: Seleziona la più recente.
4. Clicca su **Salva**.
5. Copia la **Chiave segreta del webhook** visualizzata in fondo alla sezione webhook di Shopify e incollala nelle Impostazioni dell'app sotto "Webhook Secret Key". Questo assicura che solo Shopify possa inviare dati alla tua app.

### C. Integrazione WhatsApp (Evolution API o Manuale)
L'applicazione supporta tre modalità impostabili nella dashboard:

1. **Manuale (Gratuito)**:
   - Non richiede configurazioni API.
   - Nella lista degli ordini, cliccando sull'icona del telefono verde, si aprirà una scheda di WhatsApp Web con il testo precompilato (compreso il link di conferma automatica). Dovrai solo premere invio per spedirlo.
2. **Evolution API (Automatico)**:
   - Consente l'invio automatico in background tramite scansione di un codice QR sul tuo account WhatsApp.
   - Richiede l'installazione di una istanza di Evolution API. Inserisci l'URL dell'API, la chiave API (apikey) e il nome dell'istanza configurata.
3. **Custom API**:
   - Se utilizzi un altro gateway o servizio di invio messaggi. Invia una richiesta POST JSON con `{ "to": "numero", "message": "testo" }` all'URL specificato.

---

## 💻 Test di Funzionamento in Locale (con ngrok)

Se desideri testare il flusso completo in locale prima del deploy:
1. Installa ngrok sul tuo computer ed avvia un tunnel sulla porta del backend (5000):
   ```bash
   ngrok http 5000
   ```
2. Copia l'indirizzo HTTPS generato da ngrok (es. `https://abcd-123.ngrok-free.app`).
3. Incolla questo indirizzo nelle Impostazioni dell'app sotto **URL Pubblico dell'Applicazione**.
4. Crea il webhook su Shopify (come descritto sopra) inserendo come URL: `https://abcd-123.ngrok-free.app/webhooks/shopify/orders-create`.
5. Effettua un ordine di test sul tuo negozio Shopify selezionando il pagamento in contrassegno.
6. L'ordine apparirà istantaneamente nella dashboard e riceverai il messaggio WhatsApp di prova!

---

## 🚀 Linee Guida per il Deploy in Produzione
Puoi ospitare questa applicazione su qualsiasi piattaforma cloud o VPS che supporti Node.js e un file system persistente (per conservare il database SQLite `database.sqlite`):
- **Railway / Render**: Piattaforme ideali e facilissime da configurare. Assicurati di aggiungere un "Persistent Volume" montato sulla cartella dell'applicazione per evitare che il file SQLite venga resettato ad ogni riavvio del container.
- **VPS (Ubuntu/Debian)**: Installa Node.js, clona il repository e usa `pm2` per tenere attivo il processo in background dietro a un reverse proxy Nginx con certificato SSL Let's Encrypt.
