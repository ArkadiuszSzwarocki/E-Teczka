$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:CENTRAL_MARIADB_HOST = '192.168.0.12'
$env:CENTRAL_MARIADB_PORT = '3307'
$env:CENTRAL_MARIADB_DATABASE = 'E-Teczka'
$env:CENTRAL_MARIADB_USER = 'mojateczka_app'
$securePassword = Read-Host 'Haslo uzytkownika mojateczka_app (nie bedzie wyswietlane)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:CENTRAL_MARIADB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  & node 'mariadb/migrate.js'
  if ($LASTEXITCODE -ne 0) { throw 'Migracja nie zakonczyla sie poprawnie.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Item Env:CENTRAL_MARIADB_PASSWORD -ErrorAction SilentlyContinue
  $securePassword.Dispose()
}
