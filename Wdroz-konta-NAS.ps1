[CmdletBinding()]
param(
    [string]$NasUser,
    [ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$NasHost = '192.168.0.12',
    [ValidateRange(1,65535)][int]$SshPort = 22,
    [switch]$Sudo,
    [switch]$UpdateSecrets,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$source = Join-Path $projectRoot 'central-accounts'
$remoteBase = '/share/Container/eteczka-accounts'
$releaseId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$workRoot = Join-Path $projectRoot '.local\nas-deploy'
$work = Join-Path $workRoot $releaseId
$stage = Join-Path $work 'source'
$archive = Join-Path $work 'accounts.tar.gz'

foreach ($command in @('node','tar','ssh','scp')) {
    if (!(Get-Command $command -ErrorAction SilentlyContinue)) { throw "Brak programu: $command" }
}
if (!(Test-Path -LiteralPath (Join-Path $source '.env'))) { throw 'Brakuje central-accounts/.env.' }
if (!$PrepareOnly -and !$NasUser) { $NasUser = Read-Host 'Nazwa uzytkownika SSH na NAS-ie (nie haslo)' }
if (!$PrepareOnly -and $NasUser -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$') { throw 'Nieprawidlowa nazwa uzytkownika SSH.' }

New-Item -ItemType Directory -Force -Path $work | Out-Null
# Restrict the local bundle, because it contains the SMTP and DB credentials.
$acl = Get-Acl -LiteralPath $work
$acl.SetAccessRuleProtection($true, $false)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $work -AclObject $acl

try {
    & node (Join-Path $projectRoot 'scripts\prepare-accounts-nas.js') $source $stage
    if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie przygotowac paczki.' }
    & tar -czf $archive -C $stage .
    if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie spakowac plikow.' }
    if ($PrepareOnly) {
        Write-Host "Paczka gotowa: $archive" -ForegroundColor Green
        Write-Host 'Zawiera sekrety. Nie wysylaj jej do repozytorium ani w wiadomosciach.'
        return
    }
    $remote = "$NasUser@$NasHost"
    $sshArgs = @('-p', [string]$SshPort)
    Write-Host 'Laczenie z NAS-em. SSH moze poprosic o haslo i potwierdzenie klucza serwera.' -ForegroundColor Cyan
    & ssh @sshArgs $remote "umask 077; mkdir -p '$remoteBase/incoming' '$remoteBase/releases' '$remoteBase/shared'"
    if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie polaczyc z NAS-em lub utworzyc katalogu.' }
    # Legacy SCP is supported by QNAP installations without an SFTP subsystem.
    & scp -O -P $SshPort $archive "${remote}:$remoteBase/incoming/$releaseId.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Kopiowanie paczki nie powiodlo sie.' }
    & scp -O -P $SshPort (Join-Path $projectRoot 'scripts\deploy-accounts-nas.sh') "${remote}:$remoteBase/incoming/$releaseId.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Kopiowanie skryptu NAS nie powiodlo sie.' }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $update = if ($UpdateSecrets) { 'yes' } else { 'no' }
    $prefix = if ($Sudo) { 'sudo ' } else { '' }
    & ssh @sshArgs -t $remote "${prefix}sh '$remoteBase/incoming/$releaseId.sh' '$remoteBase' '$releaseId' '$hash' '$update'"
    if ($LASTEXITCODE -ne 0) { throw 'Wdrozenie nie powiodlo sie. Przeczytaj komunikat powyzej; poprzednie wydania pozostaly na NAS-ie.' }
    Write-Host 'Gotowe. Kontener dziala w sieci proxy_shared.' -ForegroundColor Green
    Write-Host 'W NPM ustaw konto.arecki.pl -> http://eteczka-accounts:3001 i certyfikat SSL.'
} finally {
    # Resolve and verify the target before any recursive local cleanup.
    $resolvedWork = [System.IO.Path]::GetFullPath($work)
    $resolvedRoot = [System.IO.Path]::GetFullPath($workRoot).TrimEnd('\') + '\'
    if (!$resolvedWork.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Odmowa usuniecia katalogu poza .local/nas-deploy.' }
    if ($PrepareOnly) {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    } elseif (Test-Path -LiteralPath $resolvedWork) {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force
    }
}
