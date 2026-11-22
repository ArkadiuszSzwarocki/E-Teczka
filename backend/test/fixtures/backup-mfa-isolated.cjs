const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { generateSync } = require('otplib');

test('backup operations require Microsoft Authenticator and recovery codes cannot be reused', async () => {
  const originalDirectory = process.cwd(); const originalAppdata = process.env.APPDATA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-mfa-test-')); process.chdir(dir); process.env.APPDATA = dir; process.env.AUTH_SECRET = 'test-only-mfa-secret';
  const lockDir = path.join(dir, 'mojateczka'); fs.mkdirSync(lockDir);
  const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync('haslo-testowe', salt, 64).toString('hex');
  fs.writeFileSync(path.join(lockDir, 'access-lock.json'), JSON.stringify({ salt, hash }));
  const { createBackupMfaRouter, requireBackupMfa } = require('../../routes/backupMfa');
  const app = express(); app.use(express.json()); app.use('/mfa', createBackupMfaRouter({}));
  app.post('/destination', requireBackupMfa('destination'), (_req, res) => res.json({ ok: true }));
  app.post('/cloud', requireBackupMfa('cloud'), (_req, res) => res.json({ ok: true }));
  app.get('/export', requireBackupMfa('export'), (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/mfa/start', { password: 'zle' })).status, 401);
    const setup = await (await post('/mfa/start', { password: 'haslo-testowe' })).json();
    const secret = new URL(setup.uri).searchParams.get('secret'); assert.ok(secret);
    const enabled = await (await post('/mfa/confirm', { code: generateSync({ secret }) })).json(); assert.equal(enabled.codes.length, 10);
    assert.equal((await fetch(base + '/export')).status, 403);
    const grant = await (await post('/mfa/authorize', { action: 'send', code: enabled.codes[0] })).json(); assert.ok(grant.token);
    const headers = { 'x-backup-authorization': grant.token };
    assert.equal((await post('/destination', {}, headers)).status, 200);
    assert.equal((await post('/destination', {}, headers)).status, 403);
    assert.equal((await fetch(base + '/export', { headers })).status, 403);
    assert.equal((await post('/cloud', {}, headers)).status, 200);
    assert.equal((await post('/mfa/authorize', { action: 'send', code: enabled.codes[0] })).status, 401);
    assert.equal((await post('/mfa/disable', { password: 'wrong', code: enabled.codes[1] })).status, 401);
    assert.equal((await post('/mfa/disable', { password: 'haslo-testowe', code: enabled.codes[1] })).status, 200);
    assert.equal((await fetch(base + '/export')).status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'security', 'backup-mfa.enc'), 'utf8').includes(secret), false);
  } finally { await new Promise(resolve => server.close(resolve)); process.chdir(originalDirectory); if (originalAppdata === undefined) delete process.env.APPDATA; else process.env.APPDATA = originalAppdata; fs.rmSync(dir, { recursive: true, force: true }); }
});
