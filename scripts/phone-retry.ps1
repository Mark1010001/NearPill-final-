$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
& $adb -s $phone shell input tap 161 836      # "Try again" on Home
Start-Sleep 6
& $adb -s $phone shell screencap -p /sdcard/np.png
& $adb -s $phone pull /sdcard/np.png "$logs\phone.png" | Out-Null
& $adb -s $phone shell rm /sdcard/np.png
