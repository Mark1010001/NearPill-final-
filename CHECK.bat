@echo off
cd /d "%~dp0"
del logs\check-summary.txt 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-web.ps1
