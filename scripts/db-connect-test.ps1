# Connection test for the STAGING migrator login. Connects, runs SELECT 1, and prints the exact error if it cannot.
# It changes nothing. The password is typed hidden and is never written to disk or logs.
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$ref = 'afqqozfjpiodanpogvfb'
$secure = Read-Host 'Type the nearpill_migrator database password (hidden), then press Enter' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$ca = (Select-String -Path (Join-Path $root 'backend\.env') -Pattern '^NODE_EXTRA_CA_CERTS=(.*)$' | Select-Object -First 1)
if ($ca) { $env:NODE_EXTRA_CA_CERTS = $ca.Matches[0].Groups[1].Value.Trim(); Write-Host ("CA file: " + $env:NODE_EXTRA_CA_CERTS + "  exists=" + (Test-Path $env:NODE_EXTRA_CA_CERTS)) }
$env:NODE_OPTIONS = '--dns-result-order=ipv4first'
$env:T_HOST = 'aws-0-ap-southeast-1.pooler.supabase.com'
$env:T_USER = "nearpill_migrator.$ref"
$env:T_PASS = $plain
Set-Location (Join-Path $root 'backend')
$js = @'
const pg = require('pg');
const started = Date.now();
const c = new pg.Client({ host: process.env.T_HOST, port: 5432, user: process.env.T_USER, password: process.env.T_PASS, database: 'postgres', ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
c.connect().then(() => c.query('select current_user as u')).then((r) => { console.log('CONNECTED as', r.rows[0].u, 'in', Date.now() - started, 'ms'); return c.end(); })
 .catch((e) => { console.log('FAILED after', Date.now() - started, 'ms:', e.code || '', e.message); process.exit(1); });
'@
Write-Host ("Node version: " + (node --version))
Write-Host '--- Attempt 1: default TLS'
node -e $js
Write-Host '--- Attempt 2: TLS 1.2 only'
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --tls-max-v1.2'
node -e $js
Write-Host '--- Attempt 3: TLS 1.3 only'
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --tls-min-v1.3'
node -e $js
Remove-Item Env:T_PASS
Read-Host 'Press Enter to close'
