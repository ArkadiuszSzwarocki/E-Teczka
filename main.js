const { app, BrowserWindow, WebContentsView, ipcMain, Tray, Menu, safeStorage, shell, nativeImage } = require('electron');
ipcMain.handle('eteczka-show-main-window', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true);
  win.show();
  win.focus();
  app.focus({ steal: true });
  win.setAlwaysOnTop(false);
});
ipcMain.handle('eteczka-capture-screenshot', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !ownRenderer(event)) return null;
  const image = await win.webContents.capturePage();
  const jpeg = image.toJPEG(82);
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    appVersion: app.getVersion(),
    platform: process.platform,
  };
});
let accountAuthWindow = null;
let accountEmbedView = null;
let accountEmbedHost = null;
let accountEmbedBounds = null;
let accountGooglePopup = null;

function createCleanAccountUserAgent(webContents) {
  return webContents.getUserAgent().replace(/\s*Electron\/[^\s]+/gi, '');
}

function closeAccountViews() {
  if (accountGooglePopup && !accountGooglePopup.isDestroyed()) {
    try { accountGooglePopup.close(); } catch { /* ignore */ }
  }
  accountGooglePopup = null;
  if (accountEmbedView) {
    try {
      if (accountEmbedHost && !accountEmbedHost.isDestroyed()) {
        accountEmbedHost.contentView.removeChildView(accountEmbedView);
      }
      if (!accountEmbedView.webContents.isDestroyed()) {
        accountEmbedView.webContents.close();
      }
    } catch { /* ignore cleanup errors */ }
    accountEmbedView = null;
    accountEmbedHost = null;
    accountEmbedBounds = null;
  }
  if (accountAuthWindow && !accountAuthWindow.isDestroyed()) {
    accountAuthWindow.close();
  }
  accountAuthWindow = null;
}

function computePopupBounds() {
  if (!accountEmbedHost || accountEmbedHost.isDestroyed() || !accountEmbedBounds) {
    return { width: 420, height: 420 };
  }
  const content = accountEmbedHost.getContentBounds();
  return {
    x: Math.round(content.x + accountEmbedBounds.x),
    y: Math.round(content.y + accountEmbedBounds.y),
    width: Math.max(240, Math.round(accountEmbedBounds.width)),
    height: Math.max(240, Math.round(accountEmbedBounds.height)),
  };
}

function attachGooglePopupHandler(webContents, allowedOrigin, cleanUa) {
  webContents.setUserAgent(cleanUa);
  webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    try {
      const parsed = new URL(popupUrl);
      if (parsed.protocol === 'https:' && (parsed.hostname.endsWith('.google.com') || parsed.hostname === 'accounts.google.com' || parsed.origin === allowedOrigin)) {
        const pos = computePopupBounds();
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            ...pos,
            frame: false,
            resizable: false,
            movable: false,
            skipTaskbar: true,
            hasShadow: false,
            parent: accountEmbedHost && !accountEmbedHost.isDestroyed() ? accountEmbedHost : undefined,
            backgroundColor: '#0f172a',
            webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
          },
        };
      }
    } catch { /* block invalid URLs */ }
    return { action: 'deny' };
  });
  webContents.on('did-create-window', (childWin) => {
    accountGooglePopup = childWin;
    childWin.webContents.setUserAgent(cleanUa);
    childWin.webContents.setZoomFactor(0.76);
    childWin.webContents.on('did-finish-load', () => {
      if (!childWin.isDestroyed()) {
        childWin.webContents.setZoomFactor(0.76);
        void childWin.webContents.insertCSS('html, body { overflow: hidden !important; border: 1px solid #334155 !important; border-radius: 12px !important; box-sizing: border-box !important; } ::-webkit-scrollbar { display: none !important; }').catch(() => undefined);
      }
    });
    childWin.on('closed', () => {
      if (accountGooglePopup === childWin) accountGooglePopup = null;
    });
  });
}

function sanitizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = Math.max(0, Math.round(Number(bounds.x)));
  const y = Math.max(0, Math.round(Number(bounds.y)));
  const width = Math.max(200, Math.round(Number(bounds.width)));
  const height = Math.max(200, Math.round(Number(bounds.height)));
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

ipcMain.handle('eteczka-close-external-account', async (event) => {
  if (!ownRenderer(event)) return false;
  closeAccountViews();
  return true;
});

ipcMain.handle('eteczka-resize-external-account', async (event, rawBounds) => {
  if (!ownRenderer(event) || !accountEmbedView) return false;
  const bounds = sanitizeBounds(rawBounds);
  if (bounds) {
    accountEmbedBounds = bounds;
    accountEmbedView.setBounds(bounds);
    if (accountGooglePopup && !accountGooglePopup.isDestroyed()) {
      accountGooglePopup.setBounds(computePopupBounds());
    }
  }
  return true;
});

ipcMain.handle('eteczka-open-external-account', async (event, rawUrl, rawBounds) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !ownRenderer(event) || typeof rawUrl !== 'string') return false;
  const url = new URL(rawUrl);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.pathname !== '/account' || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)) {
    throw new Error('Nieprawidłowy adres konta.');
  }
  const embedBounds = sanitizeBounds(rawBounds);
  if (embedBounds) {
    closeAccountViews();
    accountEmbedView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    accountEmbedHost = win;
    accountEmbedBounds = embedBounds;
    const cleanUa = createCleanAccountUserAgent(accountEmbedView.webContents);
    attachGooglePopupHandler(accountEmbedView.webContents, url.origin, cleanUa);
    win.contentView.addChildView(accountEmbedView);
    accountEmbedView.setBounds(embedBounds);
    accountEmbedView.webContents.setZoomFactor(0.82);
    accountEmbedView.webContents.on('did-finish-load', () => {
      if (accountEmbedView && !accountEmbedView.webContents.isDestroyed()) {
        accountEmbedView.webContents.setZoomFactor(0.82);
        void accountEmbedView.webContents.insertCSS('html, body { overflow: hidden !important; min-height: 0 !important; height: 100% !important; display: flex !important; align-items: center !important; justify-content: center !important; background: #0b1120 !important; }').catch(() => undefined);
      }
    });
    await accountEmbedView.webContents.loadURL(url.href);
    return true;
  }
  if (accountAuthWindow && !accountAuthWindow.isDestroyed()) {
    accountAuthWindow.focus();
    await accountAuthWindow.loadURL(url.href);
    return true;
  }
  const parentBounds = win.getBounds();
  const width = 520;
  const height = 680;
  const x = Math.max(0, Math.round(parentBounds.x + (parentBounds.width - width) / 2));
  const y = Math.max(0, Math.round(parentBounds.y + (parentBounds.height - height) / 2));
  accountAuthWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    parent: win,
    autoHideMenuBar: true,
    title: 'Logowanie Google — E‑Teczka',
    backgroundColor: '#0b1120',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const cleanUa = createCleanAccountUserAgent(accountAuthWindow.webContents);
  attachGooglePopupHandler(accountAuthWindow.webContents, url.origin, cleanUa);
  accountAuthWindow.on('closed', () => {
    accountAuthWindow = null;
    if (!win.isDestroyed()) win.focus();
  });
  await accountAuthWindow.loadURL(url.href);
  return true;
});
const path = require('path');
const { spawn, execFile } = require('child_process');
const http = require('http');
const fs = require('fs');
const { createAccessLock } = require('./desktop/accessLock');
const { createRecoveryMailer } = require('./desktop/recoveryMail');
const { checkWindowsHelloAvailability, verifyWithWindowsHello } = require('./desktop/windowsHello');
const { createHelloLogin } = require('./desktop/helloLogin');

// Isolated first-run testing keeps the real profile, PIN and sessions intact.
if (process.env.ETECZKA_PROFILE_DIR) {
  if (!path.isAbsolute(process.env.ETECZKA_PROFILE_DIR)) throw new Error('The test profile path must be absolute.');
  fs.mkdirSync(process.env.ETECZKA_PROFILE_DIR, { recursive: true });
  app.setPath('userData', process.env.ETECZKA_PROFILE_DIR);
}

let mainWindow;
let backendProcess;
let tray;
let quitting = false;

const recoveryMailer = createRecoveryMailer(path.join(__dirname, 'backend'));
let accessLock = createAccessLock({ file: path.join(app.getPath('userData'), 'access-lock.json'), sendRecoveryMail: recoveryMailer.send, mailConfigured: recoveryMailer.configured });
let loginMethodFile = path.join(app.getPath('userData'), 'login-method.json');
const helloLogin = createHelloLogin({ filename:path.join(app.getPath('userData'),'hello-login.bin'), safeStorage, verifyHello:verifyWithWindowsHello });
let selectedAccountEmail = '';
let lastHelloSessionToken = '';
const ownRenderer = event => Boolean(mainWindow && event.sender === mainWindow.webContents);
ipcMain.handle('eteczka-hello-accounts', event => ownRenderer(event) ? helloLogin.list() : []);
ipcMain.handle('eteczka-hello-login', async(event, settings) => {
  if(!ownRenderer(event))return {ok:false,error:'Niedostępne okno.'};
  const result=await helloLogin.login(event.sender.id,String(settings?.email||''),String(settings?.mfaCode||''));
  if(result.ok){lastHelloSessionToken=result.token;verifiedSenders.set(event.sender.id,Date.now()+5*60000);}
  return result;
});
function loginMethod() { try { const saved = JSON.parse(fs.readFileSync(loginMethodFile, 'utf8')); if (saved.method === 'pin' || saved.method === 'password' || saved.method === 'hello') return saved.method; } catch {} return accessLock.status().mode === 'pin' ? 'pin' : 'password'; }
const verifiedSenders = new Map();
const isVerified = (event) => (verifiedSenders.get(event.sender.id) || 0) > Date.now();

ipcMain.handle('eteczka-access-use-account', async (event, token) => {
  if (typeof token !== 'string' || token.length > 4096) return { ok: false, error: 'Nieprawidłowa sesja.' };
  try {
    const response = await fetch('http://127.0.0.1:3000/api/auth/me', { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('SESSION_INVALID');
    const user = await response.json();
    if (!Number.isSafeInteger(user.id) || user.id < 1) throw new Error('SESSION_INVALID');
    selectedAccountEmail = user.email;
    const root = app.getPath('userData');
    const legacy = path.join(root, 'access-lock.json');
    const file = user.id === 1 && fs.existsSync(legacy) ? legacy : path.join(root, 'accounts', String(user.id), 'access-lock.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    loginMethodFile = path.join(path.dirname(file), 'login-method.json');
    accessLock = createAccessLock({ file, sendRecoveryMail: recoveryMailer.send, mailConfigured: recoveryMailer.configured });
    if (!fs.existsSync(loginMethodFile)) fs.writeFileSync(loginMethodFile, JSON.stringify({method:accessLock.status().mode === 'pin' ? 'pin' : 'password'}), {mode:0o600});
    verifiedSenders.clear();
    if(token===lastHelloSessionToken)verifiedSenders.set(event.sender.id,Date.now()+5*60000);
    return { ok: true };
  } catch { return { ok: false, error: 'Nie udało się sprawdzić konta dla lokalnej blokady.' }; }
});

ipcMain.handle('eteczka-access-status', event => ({ ...accessLock.status(), loginMethod: loginMethod(), helloVerified:isVerified(event), helloLoginRegistered:helloLogin.list().some(item=>item.email===selectedAccountEmail) }));
ipcMain.handle('eteczka-hello-available', () => checkWindowsHelloAvailability());
ipcMain.handle('eteczka-hello-verify', async (event) => {
  const result = await verifyWithWindowsHello('Potwierdź tożsamość w E-Teczce');
  if (result.ok) verifiedSenders.set(event.sender.id, Date.now() + 5 * 60_000);
  return result;
});
ipcMain.handle('eteczka-access-set-method', async (event, settings) => {
  if(!ownRenderer(event))return {ok:false,error:'Niedostępne okno.'};
  if (!settings || !['password','pin','hello'].includes(settings.method)) return { ok: false, error: 'Niedostępna metoda logowania.' };
  const status = accessLock.status();
  if (status.configured && !accessLock.verify(settings.currentSecret).ok) return { ok: false, error: 'Potwierdź obecną blokadę, aby zmienić sposób logowania.' };
  if (settings.method === 'pin' && (!status.configured || status.mode !== 'pin')) return { ok: false, error: 'Najpierw ustaw PIN w sekcji Zmiana PIN-u.' };
  if (settings.method === 'hello') {
    const hello = await checkWindowsHelloAvailability();
    if (!hello.available) return { ok: false, error: 'Windows Hello nie jest skonfigurowane na tym urządzeniu.' };
    const result=await helloLogin.enroll(settings.token,settings.deviceId);if(!result.ok)return result;
  } else if(helloLogin.list().some(item=>item.email===selectedAccountEmail)) {
    const result=await helloLogin.revoke(settings.token,selectedAccountEmail);if(!result.ok)return result;
  }
  try { fs.writeFileSync(loginMethodFile + '.tmp', JSON.stringify({method:settings.method}), {mode:0o600}); fs.renameSync(loginMethodFile + '.tmp', loginMethodFile); return {ok:true}; }
  catch { return {ok:false,error:'Nie udało się zapisać metody.'}; }
});
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
  const backendDir = path.join(__dirname, 'backend');
  const tsNodeBin = path.join(backendDir, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const useTsNode = Boolean(process.env.ETECZKA_DEV_URL) && fs.existsSync(tsNodeBin);
  const args = useTsNode ? [tsNodeBin, '--preferTsExts', path.join(backendDir, 'index.ts')] : [path.join(backendDir, 'index.js')];
  backendProcess = spawn('node', args, {
    cwd: backendDir,
    env: { ...process.env, PORT: '3000' }
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[BACKEND]: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[BACKEND ERR]: ${data}`);
  });
}

function findPort3000Pid() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess'], (err, stdout) => {
      const pid = Number((stdout || '').trim());
      resolve(Number.isInteger(pid) && pid > 0 ? pid : null);
    });
  });
}

async function restartBackendForDev() {
  if (backendProcess) {
    try { backendProcess.kill(); } catch {}
    backendProcess = null;
  } else {
    const pid = await findPort3000Pid();
    if (pid && pid !== process.pid) {
      try { process.kill(pid); } catch {}
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (!(await backendAvailable())) startBackend();
  for (let i = 0; i < 60; i++) {
    if (await backendAvailable()) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

ipcMain.handle('eteczka-dev-reload', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !ownRenderer(event) || !process.env.ETECZKA_DEV_URL) return false;
  await restartBackendForDev();
  if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
  return true;
});

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
  const appIconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: 'E-Teczka – Cyfrowe Archiwum Dokumentów',
    ...(fs.existsSync(appIconPath) ? { icon: appIconPath } : {}),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Native input also covers embedded PDF frames, whose DOM events do not bubble.
  let lastSessionInput=0;
  const sessionInput=()=>{const now=Date.now();if(now-lastSessionInput<500)return;lastSessionInput=now;if(mainWindow&&!mainWindow.webContents.isDestroyed())mainWindow.webContents.send('eteczka-user-activity');};
  mainWindow.webContents.on('before-mouse-event',sessionInput);
  mainWindow.webContents.on('before-input-event',sessionInput);

  mainWindow.maximize();
  if (process.env.ETECZKA_PROFILE_DIR) {
    mainWindow.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle('E-Teczka - TEST NOWEGO UZYTKOWNIKA'); });
    mainWindow.setTitle('E-Teczka - TEST NOWEGO UZYTKOWNIKA');
  }
  const startUrl = process.env.ETECZKA_DEV_URL || `file://${path.join(__dirname, 'frontend', 'dist', 'index.html')}`;
  mainWindow.loadURL(startUrl);

  if (process.env.ETECZKA_DEV_URL) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('eteczka-confirm-close');
  });
}

ipcMain.handle('eteczka-minimize-to-tray', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !ownRenderer(event) || win.isDestroyed()) return false;
  win.hide();
  if (process.platform === 'win32' && tray) {
    tray.displayBalloon({ title: 'E-Teczka', content: 'Aplikacja została zminimalizowana do zasobnika przy zegarze.' });
  }
  return true;
});

ipcMain.handle('eteczka-quit-app', (event) => {
  if (!ownRenderer(event)) return false;
  void quitGracefully();
  return true;
});

let quitInProgress = false;
async function quitGracefully() {
  if (quitInProgress) return;
  quitInProgress = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    await new Promise((resolve) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; clearTimeout(timer); ipcMain.removeHandler('eteczka-quit-ready'); resolve(); } };
      const timer = setTimeout(done, 60_000);
      ipcMain.handle('eteczka-quit-ready', () => { done(); return true; });
      mainWindow.webContents.send('eteczka-prepare-quit');
    });
  }
  quitting = true;
  app.quit();
}

async function createTray() {
  try {
    const customIconPath = path.join(__dirname, 'assets', 'icon.png');
    const icon = fs.existsSync(customIconPath)
      ? nativeImage.createFromPath(customIconPath).resize({ width: 16, height: 16 })
      : await app.getFileIcon(process.execPath, { size: 'small' });
    if (icon.isEmpty()) return;
    tray = new Tray(icon);
    tray.setToolTip('E-Teczka — działa w tle');
    const show = () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } };
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Otwórz E-Teczkę', click: show },
      { type: 'separator' },
      { label: 'Zakończ E-Teczkę', click: () => { void quitGracefully(); } },
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
