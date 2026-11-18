$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$env:PATH = "C:\flutter\bin;$env:PATH"; Set-Location $root
flutter analyze lib 2>&1 | Out-File "$logs\quick-analyze.log" -Encoding utf8
flutter test test/map_test.dart test/medicine_search_test.dart test/cart_eligibility_test.dart test/medicine_guidance_test.dart test/assistant_test.dart test/service_information_test.dart 2>&1 | Out-File "$logs\quick-test.log" -Encoding utf8
'quick done' | Set-Content "$logs\quick-done.txt"
