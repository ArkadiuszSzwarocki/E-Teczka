param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$projectDir = Join-Path $PSScriptRoot 'MojaTeczkaMobile'
$androidDir = Join-Path $projectDir 'android'
$gradlew = Join-Path $androidDir 'gradlew.bat'
$apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'

function Find-Adb {
    $command = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidates = @()
    if ($env:ANDROID_HOME) { $candidates += Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }
    if ($env:ANDROID_SDK_ROOT) { $candidates += Join-Path $env:ANDROID_SDK_ROOT 'platform-tools\adb.exe' }
    $candidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    throw 'Nie znaleziono adb. Zainstaluj Android SDK Platform Tools i dodaj adb do PATH.'
}

function Get-Phone([string]$adb) {
    $output = & $adb devices 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Nie udalo sie uruchomic adb: $($output -join ' ')" }
    $devices = @($output | ForEach-Object { if ("$_" -match '^\s*(\S+)\s+device\s*$') { $Matches[1] } })
    if ($devices.Count -ne 1) {
        Write-Host ($output -join [Environment]::NewLine)
        throw 'Podlacz i odblokuj jeden telefon z wlaczonym debugowaniem USB. Potwierdz debugowanie na telefonie.'
    }
    return $devices[0]
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDir 'package.json') -PathType Leaf) -or -not (Test-Path -LiteralPath $gradlew -PathType Leaf)) { throw "Nie znaleziono projektu Android w $projectDir" }
    if (-not (Test-Path -LiteralPath (Join-Path $projectDir 'node_modules') -PathType Container)) { throw 'Brak node_modules w projekcie mobilnym. Najpierw zainstaluj zaleznosci projektu.' }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Nie znaleziono Node.js w PATH.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Nie znaleziono npm w PATH.' }
    if (-not (Get-Command java.exe -ErrorAction SilentlyContinue) -and -not $env:JAVA_HOME) { throw 'Nie znaleziono Javy. Ustaw JAVA_HOME lub dodaj java do PATH.' }
    $adb = Find-Adb
    $device = Get-Phone $adb
    Write-Host "Telefon gotowy: $device" -ForegroundColor Green
    Write-Host "Projekt: $projectDir"
    if ($CheckOnly) { Write-Host 'Kontrola wstepna zakonczona.'; exit 0 }

    $env:GRADLE_USER_HOME = 'A:\MojaTeczkaGradle'
    $env:TEMP = 'A:\MojaTeczkaTemp'
    $env:TMP = $env:TEMP
    $env:NODE_ENV = 'production'
    foreach ($dir in @($env:GRADLE_USER_HOME, $env:TEMP)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    Write-Host 'Sprawdzam kod aplikacji...' -ForegroundColor Cyan
    Push-Location $projectDir
    try { & npm.cmd run typecheck; if ($LASTEXITCODE -ne 0) { throw 'Sprawdzanie kodu nie powiodlo sie. APK nie zostal wgrany.' } }
    finally { Pop-Location }

    Write-Host 'Buduje APK z aktualnego kodu. To moze potrwac kilka minut...' -ForegroundColor Cyan
    Push-Location $androidDir
    try { & $gradlew ':app:assembleDebug' '--no-daemon' '--console=plain'; if ($LASTEXITCODE -ne 0) { throw 'Budowanie nie powiodlo sie. APK nie zostal wgrany.' } }
    finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'Gradle nie utworzyl pliku APK.' }
    $deviceAfterBuild = Get-Phone $adb
    if ($deviceAfterBuild -ne $device) { throw 'Telefon zmienil sie podczas budowania. Uruchom skrypt ponownie z jednym wybranym telefonem.' }

    Write-Host 'Instaluje aktualizacje na telefonie...' -ForegroundColor Cyan
    & $adb -s $device install -r $apk
    if ($LASTEXITCODE -ne 0) { throw 'Instalacja nie powiodla sie. Sprawdz komunikat adb i polaczenie z telefonem.' }
    Write-Host 'Gotowe. Aplikacja zostala zaktualizowana na telefonie.' -ForegroundColor Green
    Write-Host 'Jesli telefon zapyta o zgode na instalacje, potwierdz ja na ekranie.'
    exit 0
} catch {
    Write-Host "BLAD: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
