const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const { createAccessLock } = require('./desktop/accessLock');
const { createRecoveryMailer } = require('./desktop/recoveryMail');

let mainWindow;
let backendProcess;
let tray;
let quitting = false;

const recoveryMailer = createRecoveryMailer(path.join(__dirname, 'backend'));
const accessLock = createAccessLock({ file: path.join(app.getPath('userData'), 'access-lock.json'), sendRecoveryMail: recoveryMailer.send, mailConfigured: recoveryMailer.configured });
const verifiedSenders = new Map();
const isVerified = (event) => (verifiedSenders.get(event.sender.id) || 0) > Date.now();

ipcMain.handle('eteczka-access-status', () => accessLock.status());
ipcMain.handle('eteczka-access-verify', (event, secret) => {
  const result = accessLock.verify(secret);
  if (result.ok) verifiedSenders.set(event.sender.id, Date.now() + 5 * 60_000);
  else verifiedSenders.delete(event.sender.id);
  return result;
});
ipcMain.handle('eteczka-access-configure', (event, settings) => {
  const result = accessLock.configure(settings || {}, isVerified(event));
  if (result.ok) verifiedSenders.delete(event.sender.id);
  return result;
});
ipcMain.handle('eteczka-recovery-enroll-request', (event, email) => accessLock.requestEnrollment(email, isVerified(event)));
ipcMain.handle('eteczka-recovery-enroll-complete', (event, email, code) => accessLock.completeEnrollment(email, code, isVerified(event)));
ipcMain.handle('eteczka-recovery-reset-request', () => accessLock.requestReset());
ipcMain.handle('eteczka-recovery-reset-complete', (_event, settings) => accessLock.completeReset(settings || {}));

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

ipcMain.handle('eteczka-default-printer', async () => {
  try { return (await runWiaPowerShell("$p = Get-CimInstance Win32_Printer -Filter 'Default=True' | Select-Object -First 1 -ExpandProperty Name; if ($p) { Write-Output $p }")) || ''; }
  catch { return ''; }
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

function backendAvailable() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:3000/api/network-info', (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => {
        try {
          const info = JSON.parse(body);
          resolve(response.statusCode === 200 && info.port === 3000 && Array.isArray(info.addresses));
        } catch { resolve(false); }
      });
    });
    request.setTimeout(1500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

// Funkcja sprawdzająca czy serwer backendowy już odpowiada na porcie 3000
function waitForServer(retries = 20) {
  http.get('http://127.0.0.1:3000/api/documents', (res) => {
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
  mainWindow.on('close', (event) => {
    if (!quitting && tray) { event.preventDefault(); mainWindow.hide(); }
  });
}

async function createTray() {
  try {
    const icon = await app.getFileIcon(process.execPath, { size: 'small' });
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip('E-Teczka — działa w tle');
    const show = () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } };
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Otwórz E-Teczkę', click: show },
      { type: 'separator' },
      { label: 'Zakończ E-Teczkę', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('double-click', show);
  } catch (error) { console.error('Nie udało się uruchomić ikony E-Teczki:', error); }
}

app.whenReady().then(async () => {
  await createTray();
  if (process.env.ETECZKA_EXTERNAL_BACKEND !== '1' && !(await backendAvailable())) startBackend();
  // Czekamy aż serwer wstane zanim wygenerujemy okno
  setTimeout(() => waitForServer(), 1000);
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') 
  app.quit();
});
