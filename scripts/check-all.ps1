$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Remove-Item "$logs\check-all-summary.txt" -ErrorAction SilentlyContinue
"start $(Get-Date -Format s)" | Set-Content "$logs\check-all-summary.txt"
& "$PSScriptRoot\web-e2e-one.ps1"
"web done $(Get-Date -Format s)" | Add-Content "$logs\check-all-summary.txt"
& "$PSScriptRoot\backend-test.ps1"
"backend done $(Get-Date -Format s)" | Add-Content "$logs\check-all-summary.txt"
& "$PSScriptRoot\flutter-check.ps1"
"flutter done $(Get-Date -Format s)" | Add-Content "$logs\check-all-summary.txt"
"all done" | Add-Content "$logs\check-all-summary.txt"
