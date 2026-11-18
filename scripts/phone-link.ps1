# Keeps the USB port forward (phone 127.0.0.1:8080 -> PC API) alive. It drops whenever the phone locks, reconnects or adb restarts.
$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$log = Join-Path $logs 'phone-link.txt'
"started $(Get-Date -Format o)" | Set-Content $log
while ($true) {
  try {
    $phone = (& $adb devices | Select-String '\sdevice$' | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ -notlike 'emulator-*' } | Select-Object -First 1)
    if ($phone) {
      $list = (& $adb -s $phone reverse --list) -join ' '
      if ($list -notmatch '8080') { & $adb -s $phone reverse tcp:8080 tcp:8080 | Out-Null; "$(Get-Date -Format T) re-applied reverse for $phone" | Add-Content $log }
    } else { "$(Get-Date -Format T) no phone" | Add-Content $log }
  } catch { "$(Get-Date -Format T) error $($_.Exception.Message)" | Add-Content $log }
  Start-Sleep 3
}
