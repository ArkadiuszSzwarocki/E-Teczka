const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, execFile } = require('child_process');

/** Manages the local backend child process, readiness polling, and DEV reload IPC. */
function createBackendLifecycle({ ipcMain, BrowserWindow, ownRenderer, rootDir, resolveEnv }) {
  let backendProcess = null;
  let stopping = false;
  let crashRestarts = 0;

  function logStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
  }

  function startBackend() {
    stopping = false;
    const backendDir = path.join(rootDir, 'backend');
    const tsNodeBin = path.join(backendDir, 'node_modules', 'ts-node', 'dist', 'bin.js');
    const useTsNode = Boolean(process.env.ETECZKA_DEV_URL) && fs.existsSync(tsNodeBin);
    const distEntry = path.join(backendDir, 'dist', 'index.js');
    const prodEntry = fs.existsSync(distEntry) ? distEntry : path.join(backendDir, 'index.js');
    const args = useTsNode ? [tsNodeBin, '--preferTsExts', path.join(backendDir, 'index.ts')] : [prodEntry];
    const proc = spawn(process.execPath, args, {
      cwd: backendDir,
      env: { ...process.env, ...resolveEnv(), ELECTRON_RUN_AS_NODE: '1', PORT: '3000' },
    });
    backendProcess = proc;
    proc.on('error', (err) => {
      console.error(`${logStamp()} [BACKEND SPAWN ERR]: ${err.message}`);
    });
    proc.on('exit', (code, signal) => {
      if (backendProcess === proc) backendProcess = null;
      if (stopping || code === 0) return;
      console.error(`${logStamp()} [BACKEND EXIT]: code=${code} signal=${signal}`);
      if (crashRestarts < 5) {
        crashRestarts += 1;
        setTimeout(() => { if (!stopping && !backendProcess) startBackend(); }, 1500);
      }
    });
    proc.stdout.on('data', (data) => console.log(`${logStamp()} [BACKEND]: ${data}`));
    proc.stderr.on('data', (data) => console.error(`${logStamp()} [BACKEND ERR]: ${data}`));
  }

  function stopBackend() {
    stopping = true;
    if (backendProcess) {
      try { backendProcess.kill(); } catch { /* ignore */ }
      backendProcess = null;
    }
  }

  function findPort3000Pid() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(null);
      execFile('powershell', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess'], (_err, stdout) => {
        const pid = Number((stdout || '').trim());
        resolve(Number.isInteger(pid) && pid > 0 ? pid : null);
      });
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
            resolve(response.statusCode === 200 && (info.port === 3000 || info.port === 3443) && Array.isArray(info.addresses));
          } catch { resolve(false); }
        });
      });
      request.setTimeout(1500, () => request.destroy());
      request.on('error', () => resolve(false));
    });
  }

  async function restartBackendForDev() {
    if (process.env.ETECZKA_EXTERNAL_BACKEND === '1') {
      for (let i = 0; i < 30; i++) {
        if (await backendAvailable()) return true;
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return false;
    }
    if (backendProcess) {
      stopBackend();
    } else {
      const pid = await findPort3000Pid();
      if (pid && pid !== process.pid) {
        try { process.kill(pid); } catch { /* ignore */ }
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

  function waitForServer(onReady, retries = 20) {
    backendAvailable().then((ready) => {
      if (ready) {
        console.log('Backend jest gotowy! Otwieram okno...');
        onReady();
      } else if (retries <= 0) {
        console.error('Nie udało się połączyć z lokalnym backendem.');
        onReady();
      } else {
        setTimeout(() => waitForServer(onReady, retries - 1), 500);
      }
    });
  }

  ipcMain.handle('eteczka-dev-reload', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !ownRenderer(event) || !process.env.ETECZKA_DEV_URL) return false;
    await restartBackendForDev();
    if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
    return true;
  });

  return { startBackend, stopBackend, backendAvailable, waitForServer };
}

module.exports = { createBackendLifecycle };
