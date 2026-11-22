$ErrorActionPreference = 'Stop'
$env:ETECZKA_DEV_PLANS = '1'
$env:NODE_ENV = 'development'
$projectDir = $PSScriptRoot
Set-Location -LiteralPath $projectDir

Write-Host 'Zamykanie poprzednich procesow E-Teczki...' -ForegroundColor Yellow

# 1. Kill any Electron or Node processes launched from this E-Teczka workspace
$workspaceProcs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$projectDir*" }
foreach ($p in $workspaceProcs) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# 2. Also free dev ports (3000, 3001, 3443, 5173) if still held by any process from this workspace or stale listeners
foreach ($port in @(3000, 3001, 3443, 5173)) {
    $conns = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess -and $c.OwningProcess -ne $PID) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

Start-Sleep -Milliseconds 800
Write-Host 'Uruchamianie swiezej wersji deweloperskiej E-Teczki...' -ForegroundColor Green
& npm.cmd run 'dev:desktop'
exit $LASTEXITCODE
