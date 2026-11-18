@echo off
cd /d "%~dp0"
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\start-all.ps1 || powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-all.ps1
