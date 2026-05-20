@echo off
title Shopify COD ^& WhatsApp Manager (Sviluppo)
color 0B
echo.
echo ======================================================================
echo          AVVIO DI SHOPIFY COD ^& WHATSAPP MANAGER (SVILUPPO)
echo ======================================================================
echo.
echo Avvio in corso dei server di sviluppo (Vite + Express)...
echo La dashboard sara' aperta automaticamente a breve.
echo.

timeout /t 3 /nobreak > NUL
start "" "http://localhost:3000"
npm run dev

pause
