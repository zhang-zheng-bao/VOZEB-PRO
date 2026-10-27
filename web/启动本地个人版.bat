@echo off
setlocal
cd /d "%~dp0"

set "PORT=3000"
pnpm start
