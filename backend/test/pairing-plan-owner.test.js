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
    const nextCode = await (await fetch(`${base}/api/pairing-code`, { headers: { authorization: `Bearer ${token}` } })).json();
    const denied = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingCode: nextCode.code }) });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'MOBILE_DEVICE_LIMIT_REACHED');
    const ownedStatus = await (await fetch(`${base}/api/pairing-status`, { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(ownedStatus.pairedDevices, 1); assert.equal(ownedStatus.mobileDeviceLimit, 1);
    const deviceId=ownedStatus.devices[0].id;
    const replacement=await(await fetch(`${base}/api/pairing-replacement`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({deviceId})})).json();
    assert.ok(replacement.code);assert.equal((await(await fetch(`${base}/api/pairing-code`,{headers:{authorization:`Bearer ${token}`}})).json()).code,replacement.code,'ordinary refresh preserves replacement approval');
    let before=false;await requireAccess({socket:{remoteAddress:'192.168.0.77'},header:()=>`Bearer ${paired.accessToken}`},res,()=>{before=true;});assert.equal(before,true,'old phone remains trusted until a new pairing succeeds');
    const otherPayload=`43.${Date.now()+60000}`,otherToken=Buffer.from(otherPayload).toString('base64url')+'.'+crypto.createHmac('sha256',process.env.AUTH_SECRET).update(otherPayload).digest('base64url');
    assert.equal((await fetch(`${base}/api/pairing-replacement`,{method:'POST',headers:{authorization:`Bearer ${otherToken}`,'content-type':'application/json'},body:JSON.stringify({deviceId})})).status,404);
    const updated=await fetch(`${base}/api/pair`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pairingCode:replacement.code,deviceName:'Repaired phone'})});assert.equal(updated.status,201);const newPair=await updated.json();
    let oldDenied;const deniedRes={locals:{},status(value){oldDenied=value;return this;},json(){return this;}};
    await requireAccess({socket:{remoteAddress:'192.168.0.77'},header:()=>`Bearer ${paired.accessToken}`},deniedRes,()=>assert.fail('old phone must be revoked'));assert.equal(oldDenied,401);
    let newPassed=false;await requireAccess({socket:{remoteAddress:'192.168.0.77'},header:()=>`Bearer ${newPair.accessToken}`},res,()=>{newPassed=true;});assert.equal(newPassed,true);
    const after=await(await fetch(`${base}/api/pairing-status`,{headers:{authorization:`Bearer ${token}`}})).json();assert.equal(after.pairedDevices,1);assert.equal(after.devices[0].name,'Repaired phone');
    assert.equal((await fetch(`${base}/api/pairing-replacement`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:after.devices[0].id})})).status,401);
    assert.equal((await fetch(`${base}/api/pairing-status`)).status, 401);
    assert.equal((await fetch(`${base}/api/pairing-code`)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); process.chdir(os.tmpdir()); fs.rmSync(dir, { recursive: true, force: true }); }
});


test('a local PIN alone cannot authorize document API access', async () => {
  let passed = false, status;
  const res = { locals: {}, status(value) { status = value; return this; }, json() { return this; } };
  await requireAccess({ method: 'GET', path: '/documents', socket: { remoteAddress: '127.0.0.1' }, header: () => undefined }, res, () => { passed = true; });
  assert.equal(passed, false); assert.equal(status, 401);
});
