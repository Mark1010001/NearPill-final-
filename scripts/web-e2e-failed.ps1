$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
"start $(Get-Date -Format s)" | Set-Content "$logs\web-e2e2-summary.txt"
npm run typecheck:web 2>&1 | Out-File "$logs\web-typecheck.log" -Encoding utf8
"typecheck exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e2-summary.txt"
Set-Location (Join-Path $root 'web')
$env:NEARPILL_CAPSTONE_DEMO = '1'
$env:CI = ''
npx playwright test --last-failed --reporter=list --workers=1 --timeout=90000 2>&1 | Out-File "$logs\web-e2e2.log" -Encoding utf8
"e2e exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e2-summary.txt"
"done" | Add-Content "$logs\web-e2e2-summary.txt"
