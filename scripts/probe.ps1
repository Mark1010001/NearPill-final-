$logs = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'logs'
$o = @()
$o += "user=$env:USERNAME localappdata=$env:LOCALAPPDATA"
foreach ($c in 'node','npm','flutter','dart','adb','emulator','java','git','pwsh','docker','psql') { $g = Get-Command $c -ErrorAction SilentlyContinue; $o += "$c => $($g.Source)" }
$o += "node -v: $(try { node -v } catch { 'n/a' })"
$o += "NearPill dir: $(Test-Path "$env:LOCALAPPDATA\NearPill")"
$o += (Get-ChildItem "$env:LOCALAPPDATA\NearPill" -ErrorAction SilentlyContinue | Select -Expand FullName)
foreach ($p in 'C:\flutter\bin\flutter.bat',"$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe","$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",'C:\Program Files\nodejs\node.exe') { $o += "$p exists=$(Test-Path $p)" }
$o += "AVDs: $((Get-ChildItem "$env:USERPROFILE\.android\avd" -Filter *.ini -ErrorAction SilentlyContinue).Name -join ',')"
$o | Set-Content "$logs\probe.txt"
