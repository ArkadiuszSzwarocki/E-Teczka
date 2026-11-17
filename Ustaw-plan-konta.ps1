[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Email,[Parameter(Mandatory=$true)][ValidateSet('free','standard','premium')][string]$Plan,[string]$DoKiedy)
$ErrorActionPreference='Stop'
Push-Location (Join-Path $PSScriptRoot 'central-accounts')
try {
    & node --env-file=.env mariadb/set-plan.js $Email $Plan $DoKiedy
    if($LASTEXITCODE -ne 0){throw 'Nie udalo sie zapisac planu. Sprawdz komunikat powyzej.'}
} finally {Pop-Location}
