const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let backendProcess;

function accessLockPath() {
  return path.join(app.getPath('userData'), 'access-lock.json');
}

function readAccessLock() {
  try {
    const parsed = JSON.parse(fs.readFileSync(accessLockPath(), 'utf8'));
    return ['pin', 'password'].includes(parsed.mode) && parsed.salt && parsed.hash ? parsed : null;
  } catch {
    return null;
  }
}

function lockHash(secret, salt) {
  return crypto.scryptSync(secret, salt, 64).toString('hex');
}

function validSecret(mode, secret) {
  return (mode === 'pin' && /^\d{6,}$/.test(secret)) || (mode === 'password' && typeof secret === 'string' && secret.length >= 8);
}

ipcMain.handle('eteczka-access-status', () => {
  const lock = readAccessLock();
  return { configured: Boolean(lock), mode: lock?.mode ?? null };
});

ipcMain.handle('eteczka-access-configure', (_event, { mode, secret }) => {
  if (!validSecret(mode, secret)) return { ok: false, error: mode === 'pin' ? 'PIN musi mieć co najmniej 6 cyfr.' : 'Hasło musi mieć co najmniej 8 znaków.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const settings = { mode, salt, hash: lockHash(secret, salt) };
  const target = accessLockPath();
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, target);
  return { ok: true, mode };
});

ipcMain.handle('eteczka-access-verify', (_event, secret) => {
  const lock = readAccessLock();
  if (!lock) return { ok: true };
  const actual = Buffer.from(lockHash(secret, lock.salt), 'hex');
  const expected = Buffer.from(lock.hash, 'hex');
  return { ok: actual.length === expected.length && crypto.timingSafeEqual(actual, expected) };
});

function runWiaPowerShell(script, onStage) {
  return new Promise((resolve, reject) => {
    const process = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: true });
    let stdout = ''; let stderr = '';
    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => { stderr += data.toString(); });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) return resolve(stdout.trim());
      reject(new Error(stderr || 'Skaner WIA nie odpowiedział. Sprawdź, czy urządzenie jest włączone i gotowe.'));
    });
  });
}

ipcMain.handle('eteczka-wia-devices', async () => {
  const script = "$ErrorActionPreference = 'Stop'; $manager = New-Object -ComObject WIA.DeviceManager; $devices = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { [PSCustomObject]@{ id = $_.DeviceID; name = [string]$_.Properties.Item('Name').Value; manufacturer = try { [string]$_.Properties.Item('Manufacturer').Value } catch { '' } } }); $devices | ConvertTo-Json -Compress";
  const output = await runWiaPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
});

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

ipcMain.handle('eteczka-wia-scan', async (event, deviceId) => acquireWithWia(deviceId, (stage) => event.sender.send('eteczka-wia-status', stage)));

function startBackend() {
  const backendPath = path.join(__dirname, 'backend', 'index.js');
  backendProcess = spawn('node', [backendPath], {
    cwd: path.join(__dirname, 'backend'),
    env: { ...process.env, PORT: '3000' }
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[BACKEND]: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[BACKEND ERR]: ${data}`);
  });
}

// Funkcja sprawdzająca czy serwer backendowy już odpowiada na porcie 3000
function waitForServer(retries = 20) {
  http.get('http://localhost:3000/api/documents', (res) => {
    if (res.statusCode >= 0) {
      console.log('Backend jest gotowy! Otwieram okno...');
      createWindow();
    } else {
      retryServer(retries);
    }
  }).on('error', () => {
    retryServer(retries);
  });
}

function retryServer(retries) {
  if (retries <= 0) {
    console.error('Nie udało się połączyć z lokalnym backendem.');
    createWindow(); // Otwórz okno mimo wszystko, by użytkownik widział interfejs
    return;
  }
  setTimeout(() => waitForServer(retries - 1), 500);
}

function createWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: 'E-Teczka – Cyfrowe Archiwum Dokumentów',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.maximize();
  const startUrl = process.env.ETECZKA_DEV_URL || `file://${path.join(__dirname, 'frontend', 'dist', 'index.html')}`;
  mainWindow.loadURL(startUrl);

  if (process.env.ETECZKA_DEV_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.env.ETECZKA_EXTERNAL_BACKEND !== '1') startBackend();
  // Czekamy aż serwer wstane zanim wygenerujemy okno
  setTimeout(() => waitForServer(), 1000);
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') 
  app.quit();
});
