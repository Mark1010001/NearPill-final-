$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$out = 'logs\audit-summary.txt'
"start $(Get-Date -Format s)" | Out-File $out -Encoding ascii
Push-Location web
$preview = Start-Process -FilePath cmd -ArgumentList '/c','npx vite preview --host 127.0.0.1 --port 4173 --strictPort > ..\logs\audit-preview.log 2>&1' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
foreach ($p in @(@('app','/app/'), @('portal','/sign-in'))) {
  npx --yes lighthouse "http://127.0.0.1:4173$($p[1])" --only-categories=performance,accessibility,best-practices --output=json --output-path="..\logs\lighthouse-$($p[0]).json" --chrome-flags="--headless=new --no-sandbox" --quiet 2>&1 | Out-File "..\logs\audit-lh-$($p[0]).log" -Encoding utf8
  "lighthouse $($p[0]) exit=$LASTEXITCODE" | Out-File ..\$out -Append -Encoding ascii
}
taskkill /PID $preview.Id /T /F | Out-Null
Pop-Location
"done" | Out-File $out -Append -Encoding ascii
