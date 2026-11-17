param([int]$KeepDays = 14)

$ErrorActionPreference = 'Stop'
$rootDir = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $rootDir '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Brak pliku central-accounts\.env.' }

$cfg = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$') {
    $cfg[$matches[1]] = $matches[2].Trim()
  }
}

$dbHost = $cfg['CENTRAL_MARIADB_HOST']
$dbPort = if ($cfg['CENTRAL_MARIADB_PORT']) { $cfg['CENTRAL_MARIADB_PORT'] } else { '3307' }
$dbName = $cfg['CENTRAL_MARIADB_DATABASE']
$dbUser = $cfg['CENTRAL_MARIADB_USER']
$dbPass = $cfg['CENTRAL_MARIADB_PASSWORD']
if (-not $dbHost -or -not $dbName -or -not $dbUser -or -not $dbPass) {
  throw 'Niepelna konfiguracja MariaDB w central-accounts\.env.'
}

$dumpTool = Get-Command mariadb-dump -ErrorAction SilentlyContinue
if (-not $dumpTool) { $dumpTool = Get-Command mysqldump -ErrorAction SilentlyContinue }
if (-not $dumpTool) { throw 'Nie znaleziono mariadb-dump ani mysqldump w PATH.' }

$backupDir = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$sqlFile = Join-Path $backupDir "eteczka-$stamp.sql"
$zipFile = "$sqlFile.zip"

$env:MYSQL_PWD = $dbPass
try {
  & $dumpTool.Source --host=$dbHost --port=$dbPort --user=$dbUser --single-transaction --routines --triggers $dbName --result-file=$sqlFile
  if ($LASTEXITCODE -ne 0) { throw "Blad zrzutu bazy MariaDB (kod $LASTEXITCODE)." }
} finally {
  Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}

Compress-Archive -LiteralPath $sqlFile -DestinationPath $zipFile -Force
Remove-Item -LiteralPath $sqlFile -Force

$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem -LiteralPath $backupDir -Filter 'eteczka-*.sql.zip' | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force
Write-Host "Kopia bazy zapisana: $zipFile" -ForegroundColor Green
