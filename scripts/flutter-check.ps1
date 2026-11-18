$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$env:PATH = "C:\flutter\bin;$env:PATH"; Set-Location $root
"start $(Get-Date -Format s)" | Set-Content "$logs\flutter-check-summary.txt"
flutter analyze lib test 2>&1 | Out-File "$logs\flutter-analyze.log" -Encoding utf8
"analyze exit=$LASTEXITCODE" | Add-Content "$logs\flutter-check-summary.txt"
flutter test 2>&1 | Out-File "$logs\flutter-test.log" -Encoding utf8
"test exit=$LASTEXITCODE" | Add-Content "$logs\flutter-check-summary.txt"
"done" | Add-Content "$logs\flutter-check-summary.txt"
