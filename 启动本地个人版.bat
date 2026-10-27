@echo off
setlocal
cd /d "%~dp0web"
set VOZEB_PRO_DATABASE_PROVIDER=file
set VOZEB_PRO_DATA_DIR=%~dp0web\.data
set NEXT_PUBLIC_SITE_URL=http://localhost:3000
set VOZEB_PRO_INTERNAL_ORIGIN=http://127.0.0.1:3000
set VOZEB_PRO_PERSONAL_MODE=true
set NEXT_PUBLIC_VOZEB_PRO_PERSONAL_MODE=true
start "VOZEB PRO 本地个人版" cmd /k "cd /d "%~dp0web" && pnpm start"
timeout /t 3 /nobreak >nul
start "" http://localhost:3000/create
