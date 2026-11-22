/** Registers IPC handlers for embedded/popup Google & Central Account authentication views. */
function registerAccountEmbedIpc({ ipcMain, BrowserWindow, WebContentsView, ownRenderer }) {
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
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
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
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
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
}

module.exports = { registerAccountEmbedIpc };
