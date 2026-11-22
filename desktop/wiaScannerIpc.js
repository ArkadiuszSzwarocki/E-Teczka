const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** Registers Windows WIA scanner, default printer, and temporary scan file IPC handlers. */
function registerWiaScannerIpc({ app, ipcMain, ownRenderer }) {
  function runWiaPowerShell(script) {
    return new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) return resolve(stdout.trim());
        reject(new Error(stderr || 'Skaner WIA nie odpowiedział. Sprawdź, czy urządzenie jest włączone i gotowe.'));
      });
    });
  }

  function acquireWithWia(deviceId, onStage) {
    const outputPath = path.join(app.getPath('temp'), `eteczka_wia_${Date.now()}.jpg`);
    const escapedPath = outputPath.replace(/'/g, "''");
    const escapedDeviceId = String(deviceId).replace(/'/g, "''");
    const script = `$ErrorActionPreference = 'Stop'; $manager = New-Object -ComObject WIA.DeviceManager; $info = @($manager.DeviceInfos | Where-Object { $_.DeviceID -eq '${escapedDeviceId}' })[0]; if ($null -eq $info) { throw 'Wybrane urządzenie nie jest już dostępne.' }; $device = $info.Connect(); $item = $device.Items.Item(1); $image = $item.Transfer('{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'); $image.SaveFile('${escapedPath}'); Write-Output '${escapedPath}'`;
    onStage('Łączenie ze skanerem…');
    setTimeout(() => onStage('Skanowanie strony…'), 700);
    return runWiaPowerShell(script).then((output) => {
      const scannedPath = output.split(/\r?\n/).at(-1);
      if (!scannedPath || !fs.existsSync(scannedPath)) throw new Error('Skaner nie zwrócił obrazu.');
      onStage('Odbieranie obrazu…');
      return { ok: true, path: scannedPath };
    });
  }

  function resolveTempScanPath(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath) throw new Error('Nieprawidłowa ścieżka skanu.');
    const tmpBase = path.resolve(os.tmpdir());
    const target = path.resolve(rawPath);
    if (target !== tmpBase && !target.startsWith(`${tmpBase}${path.sep}`)) {
      throw new Error('Odmowa dostępu poza katalogiem tymczasowym.');
    }
    return target;
  }

  ipcMain.handle('eteczka-wia-devices', async () => {
    const script = "$ErrorActionPreference = 'Stop'; $manager = New-Object -ComObject WIA.DeviceManager; $devices = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { [PSCustomObject]@{ id = $_.DeviceID; name = [string]$_.Properties.Item('Name').Value; manufacturer = try { [string]$_.Properties.Item('Manufacturer').Value } catch { '' } } }); $devices | ConvertTo-Json -Compress";
    const output = await runWiaPowerShell(script);
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  });

  ipcMain.handle('eteczka-default-printer', async () => {
    try {
      return (await runWiaPowerShell("$p = Get-CimInstance Win32_Printer -Filter 'Default=True' | Select-Object -First 1 -ExpandProperty Name; if ($p) { Write-Output $p }")) || '';
    } catch {
      return '';
    }
  });

  ipcMain.handle('eteczka-wia-scan', async (event, deviceId) =>
    acquireWithWia(deviceId, (stage) => event.sender.send('eteczka-wia-status', stage)),
  );

  ipcMain.handle('eteczka-read-temp-scan', (event, rawPath) => {
    if (!ownRenderer(event)) throw new Error('Brak uprawnień.');
    return fs.readFileSync(resolveTempScanPath(rawPath)).toString('base64');
  });

  ipcMain.handle('eteczka-remove-temp-scan', (event, rawPath) => {
    if (!ownRenderer(event)) return false;
    try {
      const target = resolveTempScanPath(rawPath);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { registerWiaScannerIpc };
