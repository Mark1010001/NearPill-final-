$root = Resolve-Path (Join-Path $PSScriptRoot '..'); $logs = Join-Path $root 'logs'
Set-Location (Join-Path $root 'web')
$up = (Test-NetConnection 127.0.0.1 -Port 5173 -WarningAction SilentlyContinue).TcpTestSucceeded
$dev = $null
if (-not $up) { $dev = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run dev' -WindowStyle Hidden -PassThru; Start-Sleep -Seconds 12 }
node shots.mjs 2>&1 | Out-File "$logs\web-shots.log" -Encoding utf8
"exit=$LASTEXITCODE" | Add-Content "$logs\web-shots.log"
if ($dev) { taskkill /PID $dev.Id /T /F | Out-Null }
