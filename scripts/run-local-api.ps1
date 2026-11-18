$ErrorActionPreference = 'Stop'
$taskNode = Join-Path $env:LOCALAPPDATA 'NearPill\toolchains\node-v24.22.0-win-x64\node.exe'
$env:NODE_EXTRA_CA_CERTS = Join-Path $env:LOCALAPPDATA 'NearPill\supabase-ca-2021.crt'
if (!(Test-Path -LiteralPath $taskNode) -or !(Test-Path -LiteralPath $env:NODE_EXTRA_CA_CERTS)) {
    throw 'The local NearPill Node runtime and Supabase CA must be installed first.'
}
Push-Location (Join-Path $PSScriptRoot '..\backend')
try {
    # shortcut: this network resets hybrid TLS handshakes; retry default curves after network changes.
    $taskTlsSource = 'import tls from "node:tls";tls.DEFAULT_ECDH_CURVE="X25519:P-256";'
    $taskTlsInit = 'data:text/javascript;base64,' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskTlsSource))
    & $taskNode --import $taskTlsInit --env-file-if-exists=.env src/bootstrap/server.ts
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
