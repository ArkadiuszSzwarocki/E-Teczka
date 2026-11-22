const fs = require('fs');
const path = require('path');
const { createAccessLock } = require('./accessLock');
const { createRecoveryMailer } = require('./recoveryMail');
const { checkWindowsHelloAvailability, verifyWithWindowsHello } = require('./windowsHello');
const { createHelloLogin } = require('./helloLogin');

/** Registers local PIN/password lock, Windows Hello login, and recovery IPC handlers. */
function registerAccessLockIpc({ app, ipcMain, safeStorage, ownRenderer, rootDir }) {
  const recoveryMailer = createRecoveryMailer(path.join(rootDir, 'backend'));
  let accessLock = createAccessLock({
    file: path.join(app.getPath('userData'), 'access-lock.json'),
    sendRecoveryMail: recoveryMailer.send,
    mailConfigured: recoveryMailer.configured,
  });
  let loginMethodFile = path.join(app.getPath('userData'), 'login-method.json');
  const helloLogin = createHelloLogin({
    filename: path.join(app.getPath('userData'), 'hello-login.bin'),
    safeStorage,
    verifyHello: verifyWithWindowsHello,
  });

  let selectedAccountEmail = '';
  let lastHelloSessionToken = '';
  const verifiedSenders = new Map();
  const isVerified = (event) => (verifiedSenders.get(event.sender.id) || 0) > Date.now();

  function loginMethod() {
    try {
      const saved = JSON.parse(fs.readFileSync(loginMethodFile, 'utf8'));
      if (saved.method === 'pin' || saved.method === 'password' || saved.method === 'hello') return saved.method;
    } catch { /* ignore */ }
    return accessLock.status().mode === 'pin' ? 'pin' : 'password';
  }

  ipcMain.handle('eteczka-hello-accounts', event => (ownRenderer(event) ? helloLogin.list() : []));
  ipcMain.handle('eteczka-hello-login', async (event, settings) => {
    if (!ownRenderer(event)) return { ok: false, error: 'Niedostępne okno.' };
    const result = await helloLogin.login(event.sender.id, String(settings?.email || ''), String(settings?.mfaCode || ''));
    if (result.ok) {
      lastHelloSessionToken = result.token;
      verifiedSenders.set(event.sender.id, Date.now() + 5 * 60000);
    }
    return result;
  });

  ipcMain.handle('eteczka-access-use-account', async (event, token) => {
    if (typeof token !== 'string' || token.length > 4096) return { ok: false, error: 'Nieprawidłowa sesja.' };
    try {
      const response = await fetch('http://127.0.0.1:3000/api/auth/me', {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('SESSION_INVALID');
      const user = await response.json();
      if (!Number.isSafeInteger(user.id) || user.id < 1) throw new Error('SESSION_INVALID');
      selectedAccountEmail = user.email;
      const root = app.getPath('userData');
      const legacy = path.join(root, 'access-lock.json');
      const file = user.id === 1 && fs.existsSync(legacy)
        ? legacy
        : path.join(root, 'accounts', String(user.id), 'access-lock.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      loginMethodFile = path.join(path.dirname(file), 'login-method.json');
      accessLock = createAccessLock({
        file,
        sendRecoveryMail: recoveryMailer.send,
        mailConfigured: recoveryMailer.configured,
      });
      if (!fs.existsSync(loginMethodFile)) {
        fs.writeFileSync(loginMethodFile, JSON.stringify({ method: accessLock.status().mode === 'pin' ? 'pin' : 'password' }), { mode: 0o600 });
      }
      verifiedSenders.clear();
      if (token === lastHelloSessionToken) verifiedSenders.set(event.sender.id, Date.now() + 5 * 60000);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Nie udało się sprawdzić konta dla lokalnej blokady.' };
    }
  });

  ipcMain.handle('eteczka-access-status', event => ({
    ...accessLock.status(),
    loginMethod: loginMethod(),
    helloVerified: isVerified(event),
    helloLoginRegistered: helloLogin.list().some(item => item.email === selectedAccountEmail),
  }));

  ipcMain.handle('eteczka-hello-available', () => checkWindowsHelloAvailability());
  ipcMain.handle('eteczka-hello-verify', async (event) => {
    const result = await verifyWithWindowsHello('Potwierdź tożsamość w MojejTeczce');
    if (result.ok) verifiedSenders.set(event.sender.id, Date.now() + 5 * 60_000);
    return result;
  });

  ipcMain.handle('eteczka-access-set-method', async (event, settings) => {
    if (!ownRenderer(event)) return { ok: false, error: 'Niedostępne okno.' };
    if (!settings || !['password', 'pin', 'hello'].includes(settings.method)) return { ok: false, error: 'Niedostępna metoda logowania.' };
    const status = accessLock.status();
    if (status.configured && !accessLock.verify(settings.currentSecret).ok) {
      return { ok: false, error: 'Potwierdź obecną blokadę, aby zmienić sposób logowania.' };
    }
    if (settings.method === 'pin' && (!status.configured || status.mode !== 'pin')) {
      return { ok: false, error: 'Najpierw ustaw PIN w sekcji Zmiana PIN-u.' };
    }
    if (settings.method === 'hello') {
      const hello = await checkWindowsHelloAvailability();
      if (!hello.available) return { ok: false, error: 'Windows Hello nie jest skonfigurowane na tym urządzeniu.' };
      const result = await helloLogin.enroll(settings.token, settings.deviceId);
      if (!result.ok) return result;
    } else if (helloLogin.list().some(item => item.email === selectedAccountEmail)) {
      const result = await helloLogin.revoke(settings.token, selectedAccountEmail);
      if (!result.ok) return result;
    }
    try {
      fs.writeFileSync(`${loginMethodFile}.tmp`, JSON.stringify({ method: settings.method }), { mode: 0o600 });
      fs.renameSync(`${loginMethodFile}.tmp`, loginMethodFile);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Nie udało się zapisać metody.' };
    }
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
}

module.exports = { registerAccessLockIpc };
