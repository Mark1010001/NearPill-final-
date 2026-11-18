# Restarts the NearPill app on the phone and grabs quick screenshots to catch the loading screen.
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
& $adb -s $phone reverse tcp:8080 tcp:8080 | Out-Null
& $adb -s $phone shell input keyevent KEYCODE_WAKEUP
& $adb -s $phone shell am force-stop dev.nearpill.mobile
& $adb -s $phone shell am start -n dev.nearpill.mobile/.MainActivity | Out-Null
for ($i = 1; $i -le 6; $i++) {
  & $adb -s $phone shell screencap -p /sdcard/np$i.png
  & $adb -s $phone pull /sdcard/np$i.png "$logs\phone-loading-$i.png" | Out-Null
  & $adb -s $phone shell rm /sdcard/np$i.png
}
'done' | Set-Content "$logs\phone-loading-done.txt"
