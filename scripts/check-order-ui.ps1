$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
"start $(Get-Date -Format s)" | Set-Content "$logs\check-order-ui-summary.txt"
& "$PSScriptRoot\backend-test.ps1"
"backend finished $(Get-Date -Format s)" | Add-Content "$logs\check-order-ui-summary.txt"
& "$PSScriptRoot\flutter-check.ps1"
"flutter finished $(Get-Date -Format s)" | Add-Content "$logs\check-order-ui-summary.txt"
& "$PSScriptRoot\web-e2e-one.ps1"
"web finished $(Get-Date -Format s)" | Add-Content "$logs\check-order-ui-summary.txt"
"done" | Add-Content "$logs\check-order-ui-summary.txt"
