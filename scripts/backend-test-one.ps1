$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
"start $(Get-Date -Format s)" | Set-Content "$logs\backend-test-one-summary.txt"
$files = (Get-Content (Join-Path $root 'backend-test-target.txt') | Where-Object { $_.Trim() })
node --test @files 2>&1 | Out-File "$logs\backend-test-one.log" -Encoding utf8
"exit=$LASTEXITCODE" | Add-Content "$logs\backend-test-one-summary.txt"
"done" | Add-Content "$logs\backend-test-one-summary.txt"
