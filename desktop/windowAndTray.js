const fs = require('fs');
const path = require('path');

/** Manages the main BrowserWindow, system tray icon, external link handling, and graceful quit flow. */
function createWindowAndTrayController({ app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, rootDir }) {
  let mainWindow = null;
  let tray = null;
  let quitting = false;
  let quitInProgress = false;

  const ownRenderer = event => Boolean(mainWindow && event.sender === mainWindow.webContents);

  async function quitGracefully() {
    if (quitInProgress) return;
    quitInProgress = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            ipcMain.removeHandler('eteczka-quit-ready');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.removeListener('closed', done);
            }
            resolve();
          }
        };
        const timer = setTimeout(done, 60_000);
        mainWindow.once('closed', done);
        ipcMain.handle('eteczka-quit-ready', () => { done(); return true; });
        mainWindow.webContents.send('eteczka-prepare-quit');
      });
    }
    quitting = true;
    app.quit();
  }

  function createWindow() {
    if (mainWindow) return;
    const appIconPath = path.join(rootDir, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      autoHideMenuBar: true,
      title: 'MojaTeczka – Domowe Archiwum Dokumentów',
      ...(fs.existsSync(appIconPath) ? { icon: appIconPath } : {}),
      webPreferences: {
        preload: path.join(rootDir, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });

    // Native input also covers embedded PDF frames, whose DOM events do not bubble.
    let lastSessionInput = 0;
    const sessionInput = () => {
      const now = Date.now();
      if (now - lastSessionInput < 500) return;
      lastSessionInput = now;
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('eteczka-user-activity');
      }
    };
    mainWindow.webContents.on('before-mouse-event', sessionInput);
    mainWindow.webContents.on('before-input-event', sessionInput);

    mainWindow.maximize();
    if (process.env.ETECZKA_PROFILE_DIR) {
      mainWindow.on('page-title-updated', event => {
        event.preventDefault();
        mainWindow.setTitle('MojaTeczka - TEST NOWEGO UZYTKOWNIKA');
      });
      mainWindow.setTitle('MojaTeczka - TEST NOWEGO UZYTKOWNIKA');
    }

    if (process.env.ETECZKA_DEV_URL) {
      mainWindow.loadURL(process.env.ETECZKA_DEV_URL);
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
      mainWindow.loadFile(path.join(rootDir, 'frontend', 'dist', 'index.html'));
    }

    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.on('close', (event) => {
      if (quitting || !tray) return;
      event.preventDefault();
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('eteczka-confirm-close');
    });
  }

  async function createTray() {
    try {
      const customIconPath = path.join(rootDir, 'assets', 'icon.png');
      const icon = fs.existsSync(customIconPath)
        ? nativeImage.createFromPath(customIconPath).resize({ width: 16, height: 16 })
        : await app.getFileIcon(process.execPath, { size: 'small' });
      if (icon.isEmpty()) return;
      tray = new Tray(icon);
      tray.setToolTip('MojaTeczka — działa w tle');
      const show = () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } };
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Otwórz MojąTeczkę', click: show },
        { type: 'separator' },
        { label: 'Zakończ MojąTeczkę', click: () => { void quitGracefully(); } },
      ]));
      tray.on('double-click', show);
    } catch (error) {
      console.error('Nie udało się uruchomić ikony MojejTeczki:', error);
    }
  }

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
    return {
      dataUrl: `data:image/jpeg;base64,${image.toJPEG(82).toString('base64')}`,
      appVersion: app.getVersion(),
      platform: process.platform,
    };
  });

  ipcMain.handle('eteczka-open-external', async (event, rawUrl) => {
    if (!ownRenderer(event) || typeof rawUrl !== 'string') return false;
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return false;
    }
    if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'))) {
      return false;
    }
    await shell.openExternal(parsed.href, { activate: true });
    return true;
  });

  ipcMain.handle('eteczka-minimize-to-tray', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !ownRenderer(event) || win.isDestroyed()) return false;
    win.hide();
    if (process.platform === 'win32' && tray) {
      tray.displayBalloon({ title: 'MojaTeczka', content: 'Aplikacja została zminimalizowana do zasobnika przy zegarze.' });
    }
    return true;
  });

  ipcMain.handle('eteczka-quit-app', (event) => {
    if (!ownRenderer(event)) return false;
    void quitGracefully();
    return true;
  });

  return {
    ownRenderer,
    createWindow,
    createTray,
    markQuitting: () => { quitting = true; },
  };
}

module.exports = { createWindowAndTrayController };
