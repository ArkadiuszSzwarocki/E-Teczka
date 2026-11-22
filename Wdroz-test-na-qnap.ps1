param(
  [Parameter(Mandatory = $true)]
  [string]$NasHost,
  [string]$NasUser = 'admin',
  [string]$RemoteDir = '/share/Container/mojateczka-test',
  [int]$SshPort = 22,
  [switch]$Sudo,
  [switch]$SkipUpload
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$envTunnel = Join-Path $PSScriptRoot '.env.tunnel'
if (-not (Test-Path -LiteralPath $envTunnel)) {
  throw 'Brak pliku .env.tunnel z CLOUDFLARE_TEST_TUNNEL_TOKEN.'
}

$stageDir = Join-Path $env:TEMP ("mojateczka-test-qnap-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$archivePath = "$stageDir.tar"

try {
  $target = "$NasUser@$NasHost"
  if (-not $SkipUpload) {
    Write-Host '1/4 Przygotowuje paczke wdrozeniowa...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile.test-nas') -Destination $stageDir
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'compose.test-nas.yml') -Destination $stageDir
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.dockerignore') -Destination $stageDir
    Copy-Item -LiteralPath $envTunnel -Destination (Join-Path $stageDir '.env')

    $backendEnv = Join-Path $PSScriptRoot 'backend\.env'
    $nasEnvPath = Join-Path $stageDir '.env.nas'
    if (Test-Path -LiteralPath $backendEnv) {
      Get-Content -LiteralPath $backendEnv | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' } | Set-Content -LiteralPath $nasEnvPath -Encoding UTF8
    } else {
      '' | Set-Content -LiteralPath $nasEnvPath -Encoding UTF8
    }

    $robocopyExclude = @('node_modules', 'dist', '.git', '.local', 'uploads', '.scan-drafts')
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & robocopy (Join-Path $PSScriptRoot 'backend') (Join-Path $stageDir 'backend') /E /XD $robocopyExclude /XF *.db *.db-journal .env *.enc *.pem auth-secret paired-devices.json central-plan-catalog.cache.json developer-plan-catalog.json archive-workspace-*.json | Out-Null
    $rc1 = $LASTEXITCODE
    & robocopy (Join-Path $PSScriptRoot 'frontend') (Join-Path $stageDir 'frontend') /E /XD $robocopyExclude /XF .env | Out-Null
    $rc2 = $LASTEXITCODE
    $docsSrc = Join-Path $PSScriptRoot 'docs'
    if (Test-Path -LiteralPath $docsSrc) {
      & robocopy $docsSrc (Join-Path $stageDir 'docs') /E | Out-Null
    }
    $ErrorActionPreference = $prevPref
    if ($rc1 -ge 8) { throw "Blad kopiowania backend (robocopy exit $rc1)." }
    if ($rc2 -ge 8) { throw "Blad kopiowania frontend (robocopy exit $rc2)." }

    $apkRel = 'MojaTeczkaMobile\android\app\build\outputs\apk\debug\app-debug.apk'
    $apkSrc = Join-Path $PSScriptRoot $apkRel
    if (Test-Path -LiteralPath $apkSrc) {
      $apkDst = Join-Path $stageDir $apkRel
      New-Item -ItemType Directory -Path (Split-Path -Parent $apkDst) -Force | Out-Null
      Copy-Item -LiteralPath $apkSrc -Destination $apkDst
    }

    Write-Host '2/4 Pakuje archiwum tar...' -ForegroundColor Cyan
    $ErrorActionPreference = 'Continue'
    & tar -cf $archivePath -C $stageDir .
    $tarExit = $LASTEXITCODE
    $ErrorActionPreference = $prevPref
    if ($tarExit -ne 0) { throw "Nie udalo sie spakowac archiwum (tar exit $tarExit)." }

    Write-Host '3/4 Zatrzymuje lokalny tunel na Windowsie (przejmuje go QNAP)...' -ForegroundColor Cyan
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    $sshDir = Join-Path $env:USERPROFILE '.ssh'
    $sshKey = Join-Path $sshDir 'id_ed25519_mojateczka_qnap'
    if (-not (Test-Path -LiteralPath $sshKey)) {
      New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      & ssh-keygen -t ed25519 -N '""' -f $sshKey -q 2>$null
      $ErrorActionPreference = $prevEap
    }
    $useKey = $false
    if (Test-Path -LiteralPath $sshKey) {
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      & ssh -i $sshKey -o BatchMode=yes -o ConnectTimeout=5 -p $SshPort $target "echo OK" *> $null
      $keyCheck = $LASTEXITCODE
      $ErrorActionPreference = $prevEap
      if ($keyCheck -eq 0) {
        $useKey = $true
      } else {
        $pubKey = (Get-Content -LiteralPath "$sshKey.pub" -Raw).Trim()
        Write-Host "Wysylam i uruchamiam kontenery na QNAP ($target -> $RemoteDir)..." -ForegroundColor Cyan
        Write-Host "Wpisz haslo SSH do QNAP (tylko raz):" -ForegroundColor Yellow
        & ssh -p $SshPort $target "mkdir -p ~/.ssh '$RemoteDir' && chmod 700 ~/.ssh && (grep -qxF '$pubKey' ~/.ssh/authorized_keys 2>/dev/null || echo '$pubKey' >> ~/.ssh/authorized_keys) && chmod 600 ~/.ssh/authorized_keys"
        if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie polaczyc przez SSH z QNAP.' }
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & ssh -i $sshKey -o BatchMode=yes -o ConnectTimeout=5 -p $SshPort $target "echo OK" *> $null
        if ($LASTEXITCODE -eq 0) { $useKey = $true }
        $ErrorActionPreference = $prevEap
      }
    }
    if (-not $useKey) {
      Write-Host "Wysylam i uruchamiam kontenery na QNAP ($target -> $RemoteDir)..." -ForegroundColor Cyan
      & ssh -p $SshPort $target "mkdir -p '$RemoteDir'"
      if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie polaczyc przez SSH z QNAP.' }
    }

    $scpArgs = if ($useKey) { @('-i', $sshKey, '-P', "$SshPort", $archivePath, "${target}:${RemoteDir}/release.tar") } else { @('-P', "$SshPort", $archivePath, "${target}:${RemoteDir}/release.tar") }
    & scp @scpArgs
    if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie przeslac paczki na QNAP.' }
  } else {
    $sshKey = Join-Path $env:USERPROFILE '.ssh\id_ed25519_mojateczka_qnap'
    $useKey = (Test-Path -LiteralPath $sshKey)
    Write-Host "Pomijam wysylke - uruchamiam z istniejacego archiwum na QNAP ($target -> $RemoteDir)..." -ForegroundColor Cyan
  }

  $dockerPrefix = if ($Sudo) { 'sudo ' } else { '' }
  $remoteCmd = @"
set -e
for candidate in /share/*/.qpkg/container-station/bin/docker; do
  if [ -x "`$candidate" ]; then PATH="`$(dirname "`$candidate"):`$PATH"; export PATH; break; fi
done
cd '$RemoteDir'
if [ -f release.tar ]; then
  tar -xf release.tar
  rm -f release.tar
fi
chmod 600 .env .env.nas
export HOME='$RemoteDir/.home'
export DOCKER_CONFIG='$RemoteDir/.docker'
mkdir -p "`$HOME" "`$DOCKER_CONFIG"
if ${dockerPrefix}docker ps -q -f name='^mojateczka-test$' | grep -q .; then
  if ! ${dockerPrefix}docker exec mojateczka-test test -s /app/backend/prisma/data/eteczka.db && ${dockerPrefix}docker exec mojateczka-test test -s /app/backend/prisma/eteczka.db; then
    ${dockerPrefix}docker exec mojateczka-test cp /app/backend/prisma/eteczka.db /app/backend/prisma/data/eteczka.db
  fi
fi
${dockerPrefix}docker compose -f compose.test-nas.yml up -d --build
${dockerPrefix}docker compose -f compose.test-nas.yml ps
"@ -replace "`r`n", "`n"

  $sshIdentityArgs = if ($useKey) { @('-i', $sshKey) } else { @() }
  if ($Sudo) {
    & ssh @sshIdentityArgs -t -p $SshPort $target $remoteCmd
  } else {
    & ssh @sshIdentityArgs -p $SshPort $target $remoteCmd
  }
  if ($LASTEXITCODE -ne 0) { throw 'Uruchomienie kontenerow na QNAP nie powiodlo sie.' }

  Write-Host 'Gotowe! https://e-teczkatest.arecki.pl dziala teraz z QNAP-a.' -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
}
