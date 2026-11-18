$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "C:\flutter\bin;$sdk\platform-tools;$sdk\emulator;$env:PATH"
"started $(Get-Date -Format o)" | Set-Content "$logs\status.txt"
$up=$false; try { $up=(Invoke-WebRequest http://127.0.0.1:8080/api/v1/ready -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch {}
if (-not $up) { Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"$root\scripts\start-api.ps1" -WindowStyle Minimized; Start-Sleep 15 }
try { (Invoke-WebRequest http://127.0.0.1:8080/api/v1/ready -UseBasicParsing -TimeoutSec 20).Content | Set-Content "$logs\ready.txt" } catch { "READY FAIL: $_" | Set-Content "$logs\ready.txt" }
adb start-server | Out-Null
if (-not (adb devices | Select-String 'emulator-')) {
  Start-Process "$sdk\emulator\emulator.exe" -ArgumentList '-avd','Pixel_7' -WindowStyle Minimized
  adb wait-for-device; Start-Sleep 30
}
adb devices *> "$logs\adb.txt"
Set-Location $root
flutter --version 2>&1 | Out-File "$logs\flutter-version.txt" -Encoding utf8
flutter pub get 2>&1 | Out-File "$logs\flutter-pubget.log" -Encoding utf8
flutter analyze 2>&1 | Out-File "$logs\flutter-analyze.log" -Encoding utf8
flutter test 2>&1 | Out-File "$logs\flutter-test.log" -Encoding utf8
flutter run -d emulator-5554 2>&1 | Out-File "$logs\flutter-run.log" -Encoding utf8
"finished $(Get-Date -Format o)" | Add-Content "$logs\status.txt"
