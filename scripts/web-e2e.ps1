$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
"start $(Get-Date -Format s)" | Set-Content "$logs\web-e2e-summary.txt"
npm run typecheck:web 2>&1 | Out-File "$logs\web-typecheck.log" -Encoding utf8
"typecheck exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e-summary.txt"
npm run build:web 2>&1 | Out-File "$logs\web-build.log" -Encoding utf8
"build exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e-summary.txt"
Set-Location (Join-Path $root 'web')
# Uses the installed Google Chrome, so no browser download is needed.
$env:NEARPILL_CAPSTONE_DEMO = '1'
$env:CI = ''
npx playwright test --reporter=list --workers=2 --timeout=90000 --grep-invert "live" 2>&1 | Out-File "$logs\web-e2e.log" -Encoding utf8
"e2e exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e-summary.txt"
"done" | Add-Content "$logs\web-e2e-summary.txt"
