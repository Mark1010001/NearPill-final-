@echo off
cd /d "%~dp0"
set VITE_DEV_API_TARGET=http://127.0.0.1:8080
echo Starting NearPill web on http://127.0.0.1:5173/app/ - keep this window open.
npm --prefix web run dev -- --host 127.0.0.1
pause
