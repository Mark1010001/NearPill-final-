$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
"start $(Get-Date -Format s)" | Set-Content "$logs\web-check-summary.txt"
npm run typecheck:web 2>&1 | Out-File "$logs\web-typecheck.log" -Encoding utf8
"typecheck exit=$LASTEXITCODE" | Add-Content "$logs\web-check-summary.txt"
npm run build:web 2>&1 | Out-File "$logs\web-build.log" -Encoding utf8
"build exit=$LASTEXITCODE" | Add-Content "$logs\web-check-summary.txt"
"done" | Add-Content "$logs\web-check-summary.txt"
