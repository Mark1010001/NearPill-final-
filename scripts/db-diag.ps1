$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$ca = Join-Path $env:LOCALAPPDATA 'NearPill\supabase-ca-2021.crt'; if (Test-Path $ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
Set-Location $root
& node --env-file=backend/.env scripts/db-diag.mjs 2>&1 | Out-File "$logs\db-diag.txt" -Encoding utf8
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
Add-Content "$logs\db-diag.txt" "phone=$phone"
if ($phone) { Add-Content "$logs\db-diag.txt" ("reverse list: " + (& $adb -s $phone reverse --list)); Add-Content "$logs\db-diag.txt" ("phone->api: " + (& $adb -s $phone shell "toybox nc -z -w 3 127.0.0.1 8080 && echo reachable || echo NOT_reachable")) }
try { Add-Content "$logs\db-diag.txt" ("pc->api ready: " + (Invoke-WebRequest http://127.0.0.1:8080/api/v1/ready -UseBasicParsing -TimeoutSec 8).StatusCode) } catch { Add-Content "$logs\db-diag.txt" "pc->api ready: FAILED $($_.Exception.Message)" }
try { Add-Content "$logs\db-diag.txt" ("pc->api stores: " + (Invoke-WebRequest "http://127.0.0.1:8080/api/v1/stores" -UseBasicParsing -TimeoutSec 15).StatusCode) } catch { Add-Content "$logs\db-diag.txt" "pc->api drugstores: FAILED $($_.Exception.Message)" }
