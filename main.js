const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, WebContentsView, ipcMain, Tray, Menu, safeStorage, shell, nativeImage, dialog } = require('electron');
const { registerAccountEmbedIpc } = require('./desktop/accountEmbedIpc');
const { registerAccessLockIpc } = require('./desktop/accessLockIpc');
const { registerWiaScannerIpc } = require('./desktop/wiaScannerIpc');
const { createTrustedDatabaseController } = require('./desktop/trustedDatabaseIpc');
const { createBackendLifecycle } = require('./desktop/backendLifecycle');
const { createWindowAndTrayController } = require('./desktop/windowAndTray');

// Isolated first-run testing keeps the real profile, PIN and sessions intact.
if (process.env.ETECZKA_PROFILE_DIR) {
  if (!path.isAbsolute(process.env.ETECZKA_PROFILE_DIR)) throw new Error('The test profile path must be absolute.');
  fs.mkdirSync(process.env.ETECZKA_PROFILE_DIR, { recursive: true });
  app.setPath('userData', process.env.ETECZKA_PROFILE_DIR);
}

const windowCtrl = createWindowAndTrayController({
  app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, rootDir: __dirname,
});

registerAccountEmbedIpc({ ipcMain, BrowserWindow, WebContentsView, ownRenderer: windowCtrl.ownRenderer });
registerAccessLockIpc({ app, ipcMain, safeStorage, ownRenderer: windowCtrl.ownRenderer, rootDir: __dirname });
registerWiaScannerIpc({ app, ipcMain, ownRenderer: windowCtrl.ownRenderer });

const trustedDb = createTrustedDatabaseController({
  app, ipcMain, dialog, BrowserWindow, ownRenderer: windowCtrl.ownRenderer,
});

const backend = createBackendLifecycle({
  ipcMain, BrowserWindow, ownRenderer: windowCtrl.ownRenderer, rootDir: __dirname, resolveEnv: trustedDb.resolveEnv,
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      windowCtrl.createWindow();
    }
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  await windowCtrl.createTray();
  if (process.env.ETECZKA_EXTERNAL_BACKEND !== '1' && !(await backend.backendAvailable())) {
    backend.startBackend();
  }
  setTimeout(() => backend.waitForServer(windowCtrl.createWindow), 250);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowCtrl.createWindow();
  }
});

app.on('before-quit', () => {
  windowCtrl.markQuitting();
  backend.stopBackend();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    backend.stopBackend();
    app.quit();
  }
});
