# Applies the reviewed SQL migrations (0028-0030 are the pending ones) to the NearPill STAGING Supabase project.
# The migrator password is typed here, hidden, and lives only in this process. It is never written to disk or logs.
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$ref = 'afqqozfjpiodanpogvfb'
$logFile = Join-Path $logs ("migrate-staging-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")  # new file each run, so a locked old log cannot block it
$secure = Read-Host 'Type the nearpill_migrator database password (hidden), then press Enter' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ([string]::IsNullOrWhiteSpace($plain)) { Write-Host 'No password entered. Nothing was changed.'; Read-Host 'Press Enter to close'; exit 1 }
$ca = (Select-String -Path (Join-Path $root 'backend\.env') -Pattern '^NODE_EXTRA_CA_CERTS=(.*)$' | Select-Object -First 1)
if ($ca) { $env:NODE_EXTRA_CA_CERTS = $ca.Matches[0].Groups[1].Value.Trim() }
$env:NODE_ENV = 'staging'
$env:NEARPILL_MIGRATION_TARGET = 'staging'
$env:NEARPILL_MIGRATION_CONFIRMATION = 'I_APPROVE_REVIEWED_SQL_MIGRATIONS'
$env:NEARPILL_MIGRATION_OWNER_APPROVED = 'true'
$env:NEARPILL_MIGRATION_PROJECT_REF = $ref
$env:DB_HOST = 'aws-0-ap-southeast-1.pooler.supabase.com'
$env:NEARPILL_MIGRATION_EXPECTED_HOST = $env:DB_HOST
$env:DB_PORT = '5432'
$env:DB_NAME = 'postgres'
$env:NEARPILL_MIGRATION_EXPECTED_DATABASE = 'postgres'
$env:DB_SSL = 'true'
$env:DB_USER = "nearpill_migrator.$ref"
$env:MIGRATOR_DB_USER = $env:DB_USER
$env:DB_PASSWORD = $plain
Set-Location (Join-Path $root 'backend')
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --tls-max-v1.2'  # the Supabase pooler resets TLS 1.3 handshakes from Node 26
Write-Host 'Connecting to the staging database... output appears below as it happens.'
node scripts/migrate-postgres.mjs 2>&1 | Tee-Object -FilePath $logFile
"exit=$LASTEXITCODE" | Tee-Object -FilePath $logFile -Append
Remove-Item Env:DB_PASSWORD
Read-Host 'Press Enter to close'
