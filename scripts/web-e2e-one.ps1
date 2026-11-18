# Runs typecheck, then only the spec files listed (space-separated) in e2e-target.txt at the project root.
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
$targets = (Get-Content (Join-Path $root 'e2e-target.txt') -Raw).Trim() -split '\s+'
"start $(Get-Date -Format s) targets=$targets" | Set-Content "$logs\web-e2e-one-summary.txt"
npm run typecheck:web 2>&1 | Out-File "$logs\web-typecheck.log" -Encoding utf8
"typecheck exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e-one-summary.txt"
Set-Location (Join-Path $root 'web')
$env:NEARPILL_CAPSTONE_DEMO = '1'
$env:CI = ''
npx playwright test @targets --project=chromium --reporter=list --workers=2 --timeout=90000 2>&1 | Out-File "$logs\web-e2e-one.log" -Encoding utf8
"e2e exit=$LASTEXITCODE" | Add-Content "$logs\web-e2e-one-summary.txt"
"done" | Add-Content "$logs\web-e2e-one-summary.txt"
