$logs = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'logs'
"start $(Get-Date -Format s)" | Set-Content "$logs\check-wb-summary.txt"
& "$PSScriptRoot\web-e2e-one.ps1"
"web done $(Get-Date -Format s)" | Add-Content "$logs\check-wb-summary.txt"
& "$PSScriptRoot\backend-test.ps1"
"all done $(Get-Date -Format s)" | Add-Content "$logs\check-wb-summary.txt"
