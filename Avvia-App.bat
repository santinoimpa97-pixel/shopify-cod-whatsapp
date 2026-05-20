@echo off
title Shopify COD & WhatsApp Manager
color 0A
echo.
echo ======================================================================
echo        AVVIO DI SHOPIFY COD ^& WHATSAPP MANAGER (PRODUZIONE)
echo ======================================================================
echo.
echo Avvio del server in corso...
echo La dashboard sara' aperta automaticamente a breve.
echo.
echo Per chiudere l'applicazione, chiudi semplicemente questa finestra.
echo.

:: Aspetta 2 secondi prima di aprire il browser per dare tempo al database di inizializzarsi
timeout /t 2 /nobreak > NUL

:: Apre il browser predefinito a localhost:5000
start "" "http://localhost:5000"

:: Avvia il server Node.js
npm start

pause
