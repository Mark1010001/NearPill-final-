$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
"start $(Get-Date -Format s)" | Set-Content "$logs\backend-test-summary.txt"
npm run test:backend 2>&1 | Out-File "$logs\backend-test.log" -Encoding utf8
"backend tests exit=$LASTEXITCODE" | Add-Content "$logs\backend-test-summary.txt"
"done" | Add-Content "$logs\backend-test-summary.txt"
