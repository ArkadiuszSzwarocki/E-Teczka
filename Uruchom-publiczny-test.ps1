$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $PSScriptRoot

$envTunnel = Join-Path $PSScriptRoot '.env.tunnel'
$tunnelToken = $env:CLOUDFLARE_TEST_TUNNEL_TOKEN
if (-not $tunnelToken -and (Test-Path -LiteralPath $envTunnel)) {
  foreach ($line in Get-Content -LiteralPath $envTunnel) {
    if ($line -match '^\s*CLOUDFLARE_TEST_TUNNEL_TOKEN\s*=\s*(.+?)\s*$') {
      $tunnelToken = $Matches[1].Trim('"').Trim("'")
    }
  }
}

Write-Host '1/3 Buduje backend...' -ForegroundColor Cyan
npm --prefix backend run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '2/3 Buduje frontend...' -ForegroundColor Cyan
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) { exit 1 }

$cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
$cloudflaredBin = if ($cloudflaredCmd) { $cloudflaredCmd.Source } else {
  @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}

$tunnelProc = $null
if ($tunnelToken -and $cloudflaredBin) {
  Write-Host '3/3 Uruchamiam tunel Cloudflare -> https://e-teczkatest.arecki.pl' -ForegroundColor Green
  $tunnelProc = Start-Process -FilePath $cloudflaredBin -ArgumentList 'tunnel', '--no-autoupdate', 'run', '--token', $tunnelToken -PassThru -WindowStyle Minimized
}
else {
  Write-Host 'Uwaga: brak cloudflared lub tokenu w .env.tunnel — uruchamiam tylko lokalny serwer na porcie 3000.' -ForegroundColor Yellow
}

try {
  Write-Host 'Serwer testowy WWW dziala pod adresem: https://e-teczkatest.arecki.pl' -ForegroundColor Green
  $env:ETECZKA_PUBLIC_TEST_MODE = '1'
  node backend/index.js
}
finally {
  if ($tunnelProc -and -not $tunnelProc.HasExited) {
    Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
  }
}
