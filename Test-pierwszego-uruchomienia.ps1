$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$electron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $electron)) { throw 'Brakuje Electrona. Uruchom npm install w katalogu projektu.' }
foreach ($url in @('http://127.0.0.1:5173', 'http://127.0.0.1:3000/api/central-account/status')) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5 | Out-Null }
    catch { throw 'Najpierw uruchom wersje deweloperska z pulpitu, a potem ponow ten skrypt.' }
}
$profileDir = Join-Path $projectRoot ('.local\first-run-profiles\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
$names = @('ETECZKA_PROFILE_DIR', 'ETECZKA_EXTERNAL_BACKEND', 'ETECZKA_DEV_URL')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:ETECZKA_PROFILE_DIR = $profileDir
    $env:ETECZKA_EXTERNAL_BACKEND = '1'
    $env:ETECZKA_DEV_URL = 'http://127.0.0.1:5173'
    Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $projectRoot -WindowStyle Hidden
    Write-Host 'Otwarto osobne okno E-Teczki: nowy profil, bez PIN-u, sesji i zapamietanego e-maila.' -ForegroundColor Green
    Write-Host "Profil testowy: $profileDir"
    Write-Host 'Dotychczasowy profil i dokumenty pozostaja zachowane. Zarejestruj NOWY adres e-mail.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
