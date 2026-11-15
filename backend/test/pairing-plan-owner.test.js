const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-pair-owner-'));
process.chdir(dir);
process.env.AUTH_SECRET = 'test-secret-for-pair-owner';
const { registerPairingRoutes, requireAccess, configureAccountSessionValidator } = require('../middleware/accessControl');

test('paired phone inherits owner and revoked account sessions are denied', async () => {
  let active = true;
  configureAccountSessionValidator(async () => active);
  const app = express(); app.use(express.json()); registerPairingRoutes(app);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const payload = `42.${Date.now() + 60000}`;
    const token = Buffer.from(payload).toString('base64url') + '.' + crypto.createHmac('sha256', process.env.AUTH_SECRET).update(payload).digest('base64url');
    const base = `http://127.0.0.1:${server.address().port}`;
    const first = await (await fetch(`${base}/api/pairing-code`, { headers: { authorization: `Bearer ${token}` } })).json();
    active = false;
    assert.equal((await fetch(`${base}/api/pairing-code`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    active = true;
    const paired = await (await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingCode: first.code }) })).json();
    let next = false;
    const res = { locals: {}, status: () => res, json: () => { throw Error('not authorized'); } };
    await requireAccess({ socket: { remoteAddress: '192.168.0.77' }, header: () => `Bearer ${paired.accessToken}` }, res, () => { next = true; });
    assert.equal(next, true); assert.equal(res.locals.userId, 42); assert.equal(res.locals.billingOwnerKey, 'user:42');
    const second = await (await fetch(`${base}/api/pairing-code`)).json(); assert.notEqual(second.code, first.code);
  } finally { await new Promise(resolve => server.close(resolve)); process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); }
});
