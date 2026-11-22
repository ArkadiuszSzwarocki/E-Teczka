param(
  [string]$ImageName = 'mojateczka-central-accounts:latest',
  [string]$ContainerName = 'mojateczka-central-accounts',
  [switch]$ExportTar
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Nie znaleziono polecenia docker w PATH.'
}
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'Brak pliku central-accounts\.env.'
}

Write-Host "Buduje obraz $ImageName..." -ForegroundColor Cyan
& docker build --no-cache -t $ImageName .
if ($LASTEXITCODE -ne 0) { throw 'Budowanie obrazu Docker nie powiodlo sie.' }

if ($ExportTar) {
  $tarPath = Join-Path $PSScriptRoot 'mojateczka-central-accounts.tar'
  & docker save -o $tarPath $ImageName
  if ($LASTEXITCODE -ne 0) { throw 'Eksport obrazu do pliku .tar nie powiodl sie.' }
  Write-Host "Wyeksportowano obraz dla QNAP: $tarPath" -ForegroundColor Green
  exit 0
}

Write-Host "Restartuje kontener $ContainerName..." -ForegroundColor Cyan
& docker rm -f $ContainerName 2>$null | Out-Null
& docker run -d --name $ContainerName --restart unless-stopped --env-file $envFile -p 3001:3001 $ImageName
if ($LASTEXITCODE -ne 0) { throw 'Uruchomienie kontenera nie powiodlo sie.' }

Write-Host "Kontener $ContainerName zostal przebudowany i uruchomiony." -ForegroundColor Green
