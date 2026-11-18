$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$out = 'logs\final-summary.txt'
"start $(Get-Date -Format s)" | Out-File $out -Encoding ascii
cmd /c "node --test backend\test\prescription-reviews.test.mjs backend\test\packet0-migration-source-inventory.test.mjs backend\test\http-transport-contract.test.mjs > logs\final-backend.log 2>&1"
"backend exit=$LASTEXITCODE" | Out-File $out -Append -Encoding ascii
Push-Location web
cmd /c "npm run typecheck > ..\logs\final-web-typecheck.log 2>&1"
"web typecheck exit=$LASTEXITCODE" | Out-File ..\$out -Append -Encoding ascii
$env:NEARPILL_CAPSTONE_DEMO = '1'
npx playwright test --reporter=list --last-failed --workers=1 --timeout=90000 2>&1 | Out-File ..\logs\final-e2e4.log -Encoding utf8
"e2e exit=$LASTEXITCODE" | Out-File ..\$out -Append -Encoding ascii
Pop-Location
"done" | Out-File $out -Append -Encoding ascii
