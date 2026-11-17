$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'backup-mariadb.ps1'
if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Brak pliku backup-mariadb.ps1.' }

$taskName = 'E-Teczka-MariaDB-Backup'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Codzienna kopia zapasowa bazy MariaDB E-Teczka' -Force | Out-Null
Write-Host "Zarejestrowano codzienne zadanie kopii zapasowej: $taskName (03:00)." -ForegroundColor Green
