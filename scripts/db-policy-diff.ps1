$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$ref = 'afqqozfjpiodanpogvfb'
function EnvValue($name) { $m = Select-String -Path (Join-Path $root 'backend\.env') -Pattern "^$name=(.*)$" | Select-Object -First 1; if ($m) { return $m.Matches[0].Groups[1].Value.Trim().Trim('"') } }
$ca = EnvValue 'NODE_EXTRA_CA_CERTS'; if ($ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
$env:DB_HOST = "db.$ref.supabase.co"; $env:DB_PORT = '5432'; $env:DB_NAME = 'postgres'
$env:DB_USER = (EnvValue 'DB_USER').Split('.')[0]; $env:DB_PASSWORD = EnvValue 'DB_PASSWORD'
Set-Location (Join-Path $root 'backend')
node scripts/policy-diff.mjs 2>&1 | Out-File "$logs\db-policy-diff.log" -Encoding utf8
"exit=$LASTEXITCODE" | Add-Content "$logs\db-policy-diff.log"
Remove-Item Env:DB_PASSWORD
