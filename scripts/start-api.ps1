$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'; New-Item -ItemType Directory -Force $logs | Out-Null
$dir = Join-Path $env:LOCALAPPDATA 'NearPill'; New-Item -ItemType Directory -Force $dir | Out-Null
$ca = Join-Path $dir 'supabase-ca-2021.crt'
if (!(Test-Path $ca)) {
  # Official Supabase root CA (https://supabase.com/docs/guides/database/connecting-to-postgres#ssl)
  Invoke-WebRequest 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt' -OutFile $ca -UseBasicParsing
}
$env:NODE_EXTRA_CA_CERTS = $ca
Set-Location "$root\backend"
$src = 'import tls from "node:tls";tls.DEFAULT_ECDH_CURVE="X25519:P-256";'
$init = 'data:text/javascript;base64,' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($src))
& node --import $init --env-file-if-exists=.env src/bootstrap/server.ts 2>&1 | Tee-Object "$logs\api-run.log"
