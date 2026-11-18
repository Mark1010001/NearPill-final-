$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
$o = @("phone=$phone")
$o += "reverse list: $(& $adb -s $phone reverse --list)"
$o += "installed: $(& $adb -s $phone shell dumpsys package dev.nearpill.mobile | Select-String 'versionName|lastUpdateTime' | Out-String)"
$o += "phone->api: $(& $adb -s $phone shell 'printf \"GET /api/v1/ready HTTP/1.0\r\n\r\n\" | toybox nc -w 3 127.0.0.1 8080' 2>&1 | Out-String)"
$o += "logcat:"
$o += (& $adb -s $phone logcat -d -t 400 *:I | Select-String -Pattern 'flutter|nearpill|dio|Socket|Connection' | Select-Object -Last 25 | ForEach-Object { $_.Line })
$o | Set-Content "$logs\phone-diag.txt"
