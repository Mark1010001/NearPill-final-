$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location (Join-Path $root "web")
npm i --save-dev --save-exact axe-core@4.14.0 "@axe-core/playwright@4.14.0" 2>&1 | Out-File "$root\logs\axe-save.log" -Encoding utf8
"exit=$LASTEXITCODE" | Add-Content "$root\logs\axe-save.log"
