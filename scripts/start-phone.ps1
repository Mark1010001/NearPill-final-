$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Force $logs | Out-Null
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "C:\flutter\bin;$sdk\platform-tools;$env:PATH"
adb start-server | Out-Null
adb devices -l *> "$logs\phone-adb.txt"
$phone = (adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
if (-not $phone) { 'NO PHONE: connect via USB, enable USB debugging and accept the prompt on the phone.' | Set-Content "$logs\phone-status.txt"; exit 1 }
"phone=$phone abi=$(adb -s $phone shell getprop ro.product.cpu.abi) android=$(adb -s $phone shell getprop ro.build.version.release) model=$(adb -s $phone shell getprop ro.product.model)" | Set-Content "$logs\phone-status.txt"
# Make sure the API is up (start it if not)
$up=$false; try { $up=(Invoke-WebRequest http://127.0.0.1:8080/api/v1/ready -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
if (-not $up) { Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$root\scripts\start-api.ps1" -WindowStyle Minimized; Start-Sleep 15 }
adb -s $phone reverse tcp:8080 tcp:8080 *>> "$logs\phone-status.txt"
Set-Location $root
flutter run -d $phone --dart-define=API_BASE_URL=http://127.0.0.1:8080 2>&1 | Out-File "$logs\phone-run.log" -Encoding utf8
