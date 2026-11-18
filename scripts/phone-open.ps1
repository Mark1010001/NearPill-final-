$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
& $adb -s $phone reverse tcp:8080 tcp:8080 | Out-Null
& $adb -s $phone shell input keyevent KEYCODE_WAKEUP
& $adb -s $phone shell am force-stop dev.nearpill.mobile
& $adb -s $phone shell am start -n dev.nearpill.mobile/.MainActivity | Out-File "$logs\phone-open.txt"
Start-Sleep 10
& $adb -s $phone shell screencap -p /sdcard/np.png
& $adb -s $phone pull /sdcard/np.png "$logs\phone.png" | Out-Null
(& $adb -s $phone shell dumpsys package dev.nearpill.mobile | Select-String 'lastUpdateTime') | Add-Content "$logs\phone-open.txt"
