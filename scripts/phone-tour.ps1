$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
$xs = 108,324,540,756,972
for ($i=0; $i -lt 5; $i++) {
  & $adb -s $phone shell input tap $xs[$i] 2250
  Start-Sleep 5
  & $adb -s $phone shell screencap -p /sdcard/t.png
  & $adb -s $phone pull /sdcard/t.png "$logs\tour-$i.png" | Out-Null
}
'tour done' | Set-Content "$logs\tour-done.txt"
