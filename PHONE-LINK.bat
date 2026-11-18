@echo off
cd /d "%~dp0"
rem Keep the USB link alive in a minimized window, then open the app on the phone and take a screenshot.
tasklist /v /fi "imagename eq powershell.exe" | find "phone-link" >nul || start "phone-link" /min powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phone-link.ps1
timeout /t 5 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phone-open.ps1
