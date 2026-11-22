const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkWindowsHelloAvailability, verifyWithWindowsHello } = require('../windowsHello');
const { registerWiaScannerIpc } = require('../wiaScannerIpc');

test('macOS Touch ID availability and verification succeed when supported', async () => {
  let promptedReason = '';
  const systemPreferences = {
    canPromptTouchID: () => true,
    promptTouchID: async (reason) => { promptedReason = reason; },
  };

  const avail = await checkWindowsHelloAvailability({ platform: 'darwin', systemPreferences });
  assert.deepEqual(avail, { available: true, status: 'TouchIDAvailable', provider: 'touch_id' });

  const verify = await verifyWithWindowsHello('Odblokuj MojąTeczkę', { platform: 'darwin', systemPreferences });
  assert.deepEqual(verify, { ok: true, provider: 'touch_id' });
  assert.equal(promptedReason, 'Odblokuj MojąTeczkę');
});

test('macOS Touch ID reports unavailable or cancelled cleanly', async () => {
  const unavailable = await checkWindowsHelloAvailability({
    platform: 'darwin',
    systemPreferences: { canPromptTouchID: () => false },
  });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.status, 'TouchIDUnavailable');

  const cancelled = await verifyWithWindowsHello('Odblokuj MojąTeczkę', {
    platform: 'darwin',
    systemPreferences: {
      canPromptTouchID: () => true,
      promptTouchID: async () => { throw new Error('User cancelled'); },
    },
  });
  assert.equal(cancelled.ok, false);
  assert.match(cancelled.error, /Touch ID/i);
});

test('WIA scanner IPC degrades cleanly on macOS without invoking PowerShell', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };
  registerWiaScannerIpc({
    app: { getPath: () => '/tmp' },
    ipcMain,
    ownRenderer: () => true,
    platform: 'darwin',
  });

  const devices = await handlers.get('eteczka-wia-devices')();
  assert.deepEqual(devices, []);

  const printer = await handlers.get('eteczka-default-printer')();
  assert.equal(printer, '');

  await assert.rejects(
    () => handlers.get('eteczka-wia-scan')({ sender: { send: () => {} } }, 'dev-1'),
    /macOS/i,
  );
});

test('root package.json defines MojaTeczka electron-builder config for Windows and macOS', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.equal(pkg.build?.productName, 'MojaTeczka');
  assert.equal(pkg.build?.appId, 'pl.arecki.mojateczka');
  assert.ok(Array.isArray(pkg.build?.mac?.target) && pkg.build.mac.target.includes('dmg'));
  assert.ok(Array.isArray(pkg.build?.win?.target) && pkg.build.win.target.includes('nsis'));
});
