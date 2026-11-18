$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location $root
npm run typecheck:web 2>&1 | Out-File "$logs\check-typecheck.log" -Encoding utf8
"typecheck exit=$LASTEXITCODE" | Add-Content "$logs\check-summary.txt"
npm run build:web 2>&1 | Out-File "$logs\check-build.log" -Encoding utf8
"build exit=$LASTEXITCODE" | Add-Content "$logs\check-summary.txt"
$sdk = "$env:LOCALAPPDATA\Android\Sdk"; $env:PATH = "C:\flutter\bin;$env:PATH"
flutter analyze 2>&1 | Out-File "$logs\check-analyze.log" -Encoding utf8
"analyze done" | Add-Content "$logs\check-summary.txt"
flutter test 2>&1 | Out-File "$logs\check-fluttertest.log" -Encoding utf8
"fluttertest done" | Add-Content "$logs\check-summary.txt"
