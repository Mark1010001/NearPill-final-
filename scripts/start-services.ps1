$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Force $logs | Out-Null
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
function Up($url) { try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { $false } }
$out = @("time=$(Get-Date -Format o)")
# API (port 8080): always restart so a stale database pool is dropped
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'bootstrap[\\/]server\.ts' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2
if (-not (Up 'http://127.0.0.1:8080/api/v1/ready')) {
  Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$root\scripts\start-api.ps1" -WindowStyle Minimized
  for ($i=0; $i -lt 20 -and -not (Up 'http://127.0.0.1:8080/api/v1/ready'); $i++) { Start-Sleep 2 }
}
$out += "api_up=$(Up 'http://127.0.0.1:8080/api/v1/ready')"
# Stop any stale web server on 5173 so it restarts pointed at the API on 8080
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep 2
# Web portal (port 5173)
if (-not (Up 'http://127.0.0.1:5173/')) {
  $env:VITE_DEV_API_TARGET = 'http://127.0.0.1:8080'
  Start-Process cmd -ArgumentList '/c',"cd /d $root && npm --prefix web run dev -- --host 127.0.0.1 > logs\web.out.log 2> logs\web.err.log" -WindowStyle Minimized
  for ($i=0; $i -lt 20 -and -not (Up 'http://127.0.0.1:5173/'); $i++) { Start-Sleep 2 }
}
$out += "web_up=$(Up 'http://127.0.0.1:5173/')"
# Phone: forward the API port over USB
& $adb start-server | Out-Null
$devs = & $adb devices -l
$out += $devs
$phones = $devs | Select-String '\sdevice\s' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' }
foreach ($p in $phones) { $out += "reverse $p : $(& $adb -s $p reverse tcp:8080 tcp:8080)" }
if (-not $phones) { $out += 'NO_PHONE_ADB' }
$out | Set-Content "$logs\services-status.txt"
