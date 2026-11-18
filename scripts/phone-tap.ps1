$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
& $adb -s $phone reverse tcp:8080 tcp:8080 | Out-Null; $cmds = Get-Content (Join-Path $root 'phone-tap.txt')
foreach ($c in $cmds) { if ($c.Trim()) { & $adb -s $phone shell input $c.Trim().Split(' '); Start-Sleep -Seconds 2 } }
& $adb -s $phone shell screencap -p /sdcard/np.png
& $adb -s $phone pull /sdcard/np.png "$logs\phone.png" | Out-Null
& $adb -s $phone shell rm /sdcard/np.png
