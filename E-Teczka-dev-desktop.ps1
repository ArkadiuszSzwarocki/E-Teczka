$ErrorActionPreference = 'Stop'
$env:ETECZKA_DEV_PLANS = '1'
$env:NODE_ENV = 'development'
$projectDir = $PSScriptRoot
Set-Location -LiteralPath $projectDir

$frontend = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
if ($frontend) {
    Write-Host 'Port 5173 jest zajety. Zamknij poprzednia wersje deweloperska lub program, ktory go uzywa.' -ForegroundColor Yellow
    exit 1
}
$backend = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -First 1
$tls = Get-NetTCPConnection -State Listen -LocalPort 3443 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($backend) {
    try {
        $info = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/network-info' -TimeoutSec 3
        $cert = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/local-ca-info' -TimeoutSec 3
        if ($info.port -ne 3443 -or $cert.fingerprint -notmatch '^([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$' -or !$tls -or $tls.OwningProcess -ne $backend.OwningProcess) { throw 'not-eteczka' }
    } catch {
        Write-Host 'Port 3000 jest zajety przez inny albo nieaktualny serwer. Nie zamykam go automatycznie.' -ForegroundColor Yellow
        exit 1
    }
    Write-Host 'Korzystam z dzialajacego serwera E-Teczki. Interfejs bedzie odswiezany po zmianach.' -ForegroundColor Green
    Write-Host 'Zmiany backendu wymagaja restartu serwera, jesli nie jest uruchomiony w trybie deweloperskim.' -ForegroundColor Yellow
    $accounts = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($accounts) {
        & npm.cmd run 'dev:desktop:existing-backend'
    } else {
        & npm.cmd run 'dev:desktop:existing-backend-accounts'
    }
} else {
    if ($tls) {
        Write-Host 'Port 3443 jest zajety przez inny proces. Nie zamykam go automatycznie.' -ForegroundColor Yellow
        exit 1
    }
    & npm.cmd run 'dev:desktop'
}
exit $LASTEXITCODE
