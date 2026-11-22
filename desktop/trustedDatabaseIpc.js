const fs = require('fs');
const path = require('path');

/** Manages trusted external data directory persistence and native Windows directory pickers. */
function createTrustedDatabaseController({ app, ipcMain, dialog, BrowserWindow, ownRenderer }) {
  const configPath = () => path.join(app.getPath('userData'), 'trusted-database.json');

  function readConfig() {
    try {
      const raw = fs.readFileSync(configPath(), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.trustedDataDir === 'string' && typeof parsed.dbFile === 'string') {
        return parsed;
      }
    } catch { /* ignore */ }
    return null;
  }

  function findDbFileInDir(dir) {
    const candidates = [
      path.join(dir, 'eteczka.db'),
      path.join(dir, 'dev.db'),
      path.join(dir, 'prisma', 'dev.db'),
      path.join(dir, 'mojateczka-db.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
    try {
      const entries = fs.readdirSync(dir);
      const anyDb = entries.find(name => name.toLowerCase().endsWith('.db') && fs.statSync(path.join(dir, name)).isFile());
      if (anyDb) return path.join(dir, anyDb);
    } catch { /* ignore */ }
    return null;
  }

  function resolveEnv() {
    const cfg = readConfig();
    if (!cfg || !fs.existsSync(cfg.trustedDataDir) || !fs.existsSync(cfg.dbFile)) return {};
    return {
      MOJATECZKA_DATA_DIR: cfg.trustedDataDir,
      DATABASE_URL: `file:${cfg.dbFile.replace(/\\/g, '/')}`,
    };
  }

  ipcMain.handle('mojateczka-pick-directory', async (event, defaultPath) => {
    if (!ownRenderer(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Wybierz folder obserwowany',
      defaultPath: typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('mojateczka-trusted-db-get', (event) => {
    if (!ownRenderer(event)) return null;
    const cfg = readConfig();
    const dirExists = Boolean(cfg && fs.existsSync(cfg.trustedDataDir));
    const dbExists = Boolean(cfg && fs.existsSync(cfg.dbFile));
    return {
      trustedDataDir: cfg?.trustedDataDir || null,
      dbFile: cfg?.dbFile || null,
      trustedAt: cfg?.trustedAt || null,
      dirExists,
      dbExists,
      exists: dirExists && dbExists,
      isExternalBackend: process.env.MOJATECZKA_EXTERNAL_BACKEND === '1',
    };
  });

  ipcMain.handle('mojateczka-trusted-db-pick', async (event) => {
    if (!ownRenderer(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Wybierz katalog danych E‑Teczki (.db, uploads, security)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) return null;
    const dir = result.filePaths[0];
    const found = findDbFileInDir(dir);
    const dbFile = found || path.join(dir, 'eteczka.db');
    return {
      dir,
      dbFile,
      existingDb: Boolean(found),
      isJsonDb: Boolean(found && found.toLowerCase().endsWith('.json')),
      hasUploads: fs.existsSync(path.join(dir, 'uploads')),
      hasSecurity: fs.existsSync(path.join(dir, 'security')),
    };
  });

  ipcMain.handle('mojateczka-trusted-db-trust', async (event, payload) => {
    if (!ownRenderer(event)) return { ok: false, error: 'Brak uprawnień.' };
    const dir = typeof payload?.dir === 'string' ? path.resolve(payload.dir.trim()) : '';
    const dbFile = typeof payload?.dbFile === 'string' ? path.resolve(payload.dbFile.trim()) : '';
    if (!dir || !dbFile || !fs.existsSync(dir)) {
      return { ok: false, error: 'Wskazany katalog nie istnieje.' };
    }
    const config = {
      trustedDataDir: dir,
      dbFile,
      trustedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8');
    return { ok: true, ...config };
  });

  ipcMain.handle('mojateczka-trusted-db-clear', (event) => {
    if (!ownRenderer(event)) return { ok: false };
    try { fs.unlinkSync(configPath()); } catch { /* ignore */ }
    return { ok: true };
  });

  return { resolveEnv };
}

module.exports = { createTrustedDatabaseController };
