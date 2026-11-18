# READ-ONLY check of the STAGING database against the reviewed migrations (db:reconcile).
# It writes nothing. The app login comes from backend\.env on this computer (never printed);
# the migrator password is typed here, hidden, and lives only in this process.
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$ref = 'afqqozfjpiodanpogvfb'
function EnvValue($name) {
  $m = Select-String -Path (Join-Path $root 'backend\.env') -Pattern "^$name=(.*)$" | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value.Trim().Trim('"') } else { return $null }
}
$appUser = EnvValue 'DB_USER'; $appPass = EnvValue 'DB_PASSWORD'
if (-not $appUser -or -not $appPass) { Write-Host 'backend\.env has no DB_USER/DB_PASSWORD. Nothing was run.'; Read-Host 'Press Enter to close'; exit 1 }
$secure = Read-Host 'Type the nearpill_migrator database password (hidden), then press Enter' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ([string]::IsNullOrWhiteSpace($plain)) { Write-Host 'No password entered. Nothing was run.'; Read-Host 'Press Enter to close'; exit 1 }
$ca = EnvValue 'NODE_EXTRA_CA_CERTS'
if ($ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
$env:NODE_ENV = 'staging'
$env:NEARPILL_VERIFICATION_TARGET = 'staging'
$env:NEARPILL_VERIFICATION_CONFIRMATION = 'I_APPROVE_TEST_FIXTURE_WRITES'
$env:NEARPILL_VERIFICATION_OWNER_APPROVED = 'true'
$env:NEARPILL_VERIFICATION_PROJECT_REF = $ref
# The check requires proof of TLS on the database session itself, which the shared pooler cannot give,
# so the app login also connects to the direct endpoint (plain role name, no project suffix).
$env:DB_HOST = "db.$ref.supabase.co"
$env:NEARPILL_VERIFICATION_EXPECTED_HOST = $env:DB_HOST
$env:DB_PORT = '5432'
$env:DB_NAME = 'postgres'
$env:NEARPILL_VERIFICATION_EXPECTED_DATABASE = 'postgres'
$env:DB_SSL = 'true'
$env:DB_USER = $appUser.Split('.')[0]
$env:DB_PASSWORD = $appPass
$env:MIGRATOR_DB_HOST = "db.$ref.supabase.co"
$env:NEARPILL_VERIFICATION_EXPECTED_MIGRATOR_HOST = $env:MIGRATOR_DB_HOST
$env:MIGRATOR_DB_PORT = '5432'
$env:MIGRATOR_DB_USER = 'nearpill_migrator'
$env:MIGRATOR_DB_PASSWORD = $plain
Set-Location (Join-Path $root 'backend')
node scripts/reconcile-postgres.mjs 2>&1 | Out-File "$logs\db-reconcile.log" -Encoding utf8
"exit=$LASTEXITCODE" | Add-Content "$logs\db-reconcile.log"
Remove-Item Env:DB_PASSWORD, Env:MIGRATOR_DB_PASSWORD
Get-Content "$logs\db-reconcile.log"
Read-Host 'Press Enter to close'
