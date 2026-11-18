# READ-ONLY lookup of the payment flagged for reconciliation on STAGING. Migrator password is typed hidden, never saved.
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$ref = 'afqqozfjpiodanpogvfb'
function EnvValue($name) { $m = Select-String -Path (Join-Path $root 'backend\.env') -Pattern "^$name=(.*)$" | Select-Object -First 1; if ($m) { return $m.Matches[0].Groups[1].Value.Trim().Trim('"') } }
$secure = Read-Host 'Type the nearpill_migrator database password (hidden), then press Enter' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$ca = EnvValue 'NODE_EXTRA_CA_CERTS'; if ($ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
$env:DB_HOST = "db.$ref.supabase.co"; $env:DB_USER = 'nearpill_migrator'; $env:DB_PASSWORD = $plain
Set-Location (Join-Path $root 'backend')
node scripts/payment-lookup.mjs 2>&1 | Out-File "$logs\db-payment-lookup.log" -Encoding utf8
"exit=$LASTEXITCODE" | Add-Content "$logs\db-payment-lookup.log"
Remove-Item Env:DB_PASSWORD
Get-Content "$logs\db-payment-lookup.log"
Read-Host 'Press Enter to close'
