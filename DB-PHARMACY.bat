@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
if exist "%LOCALAPPDATA%\NearPill\supabase-ca-2021.crt" set NODE_EXTRA_CA_CERTS=%LOCALAPPDATA%\NearPill\supabase-ca-2021.crt
node --env-file=backend/.env scripts\db-pharmacy-diag.mjs > logs\db-pharmacy.txt 2>&1
type logs\db-pharmacy.txt
pause
