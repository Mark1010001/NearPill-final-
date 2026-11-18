@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backend-test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\web-e2e-one.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\flutter-check.ps1
