const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
process.env.AUTH_SECRET = 'central-account-router-test-secret';
const { createCentralAccountRouter } = require('../routes/centralAccount');
const { createCentralHandoffs } = require('../services/centralHandoff');
const { verifyCentralSession } = require('../services/centralAccountLink');
const { createAccountService } = require('../../central-accounts/accountService');
const { createHttpApp } = require('../../central-accounts/httpApp');

test('central identity links only after both sessions and preserves the local account', async () => {
  const previous = process.env.ETECZKA_CENTRAL_ACCOUNT_URL;
  process.env.ETECZKA_CENTRAL_ACCOUNT_URL = 'https://accounts.example.com';
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE User (id INTEGER PRIMARY KEY); INSERT INTO User VALUES (1), (2)');
  const sql = strings => strings.join('?');
  const hashes = new Map([['local-one', 1], ['local-two', 2]].map(([token, id]) => [crypto.createHash('sha256').update(token).digest('hex'), id]));
  const prisma = {
    $executeRawUnsafe: async value => { db.exec(value); return 0; },
    $executeRaw: async (strings, ...values) => Number(db.prepare(sql(strings)).run(...values).changes),
    $queryRaw: async (strings, ...values) => db.prepare(sql(strings)).all(...values),
    authSession: { findFirst: async ({ where }) => hashes.has(where.tokenHash) ? { userId: hashes.get(where.tokenHash) } : null, findMany: async () => [], create: async () => ({}) },
    user: { findUnique: async ({ where }) => ({ id: where.id, email: 'local@example.com', name: 'Local' }) },
    subscription: { findUnique: async () => null }
  };
  const verify = async (_origin, token) => { if (token !== 'central-token') throw Error('invalid'); return { id: 'a'.repeat(32), email: 'remote@example.com', name: null }; };
  const app = express(); app.use(express.json()); app.use('/bridge', createCentralAccountRouter(prisma, verify));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/bridge`;
  const post = (endpoint, local, central = 'central-token') => fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(local ? { authorization: `Bearer ${local}` } : {}) }, body: JSON.stringify({ centralToken: central, deviceId: 'desktop-test' }) });
  try {
    assert.equal((await post('/link', null)).status, 401);
    assert.equal((await post('/login', null)).status, 409);
    assert.equal((await post('/link', 'local-one', 'invalid')).status, 409);
    assert.equal((await post('/link', 'local-one')).status, 204);
    assert.equal((await post('/link', 'local-two')).status, 409);
    const login = await post('/login', null); assert.equal(login.status, 200); assert.equal((await login.json()).user.id, 1);
    assert.equal((await post('/unlink', 'local-two')).status, 404);
    assert.equal((await post('/unlink', 'local-one')).status, 204);
    assert.equal((await post('/login', null)).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); if (previous === undefined) delete process.env.ETECZKA_CENTRAL_ACCOUNT_URL; else process.env.ETECZKA_CENTRAL_ACCOUNT_URL = previous; }
});

test('desktop browser handoff links and later signs into existing local account', async () => {
  const previous = process.env.ETECZKA_CENTRAL_ACCOUNT_URL; process.env.ETECZKA_CENTRAL_ACCOUNT_URL = 'https://accounts.example.com';
  const centralDb = new DatabaseSync(':memory:'); let emailCode;
  const accounts = createAccountService({ db: centralDb, sendVerification: async (_email, code) => { emailCode = code; }, verifyGoogle: async () => {} });
  await accounts.register('central@example.com', 'test-password'); await accounts.verifyEmail(emailCode, 'test-password');
  const browser = await accounts.login('central@example.com', 'test-password');
  const centralServer = createHttpApp(accounts).listen(0, '127.0.0.1'); await new Promise(resolve => centralServer.once('listening', resolve));
  const localCentral = `http://127.0.0.1:${centralServer.address().port}`;
  const remoteFetch = (url, options) => fetch(String(url).replace('https://accounts.example.com', localCentral), options);
  const handoffs = createCentralHandoffs(remoteFetch), verify = (origin, token) => verifyCentralSession(origin, token, remoteFetch);
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE User (id INTEGER PRIMARY KEY); INSERT INTO User VALUES (1)');
  const sql = strings => strings.join('?'), localHash = crypto.createHash('sha256').update('local-one').digest('hex');
  const prisma = {
    $executeRawUnsafe: async value => { db.exec(value); return 0; }, $executeRaw: async (strings, ...values) => Number(db.prepare(sql(strings)).run(...values).changes), $queryRaw: async (strings, ...values) => db.prepare(sql(strings)).all(...values),
    authSession: { findFirst: async ({ where }) => where.tokenHash === localHash ? { userId: 1 } : null, findMany: async () => [], create: async () => ({}) },
    user: { findUnique: async ({ where }) => where.email ? null : ({ id: where.id, email: 'local@example.com', name: 'Local' }), create: async ({ data }) => { db.prepare('INSERT INTO User VALUES (2)').run(); return { id: 2, email: data.email, name: data.name }; } }, subscription: { findUnique: async () => null }
  };
  prisma.$transaction = async fn => fn(prisma);
  const app = express(); app.use(express.json()); app.use('/bridge', createCentralAccountRouter(prisma, verify, handoffs, async (_prisma, owner, secret) => owner === 'desktop-local' && secret === 'correct-secret'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/bridge`;
  const post = (endpoint, body, local) => fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(local ? { authorization: `Bearer ${local}` } : {}) }, body: JSON.stringify(body) });
  try {
    const start = await (await post('/handoff/start', {})).json();
    const requestId = new URL(start.url).hash.slice(1); assert.equal(accounts.inspectHandoff(requestId).displayCode, start.displayCode);
    accounts.approveHandoff(requestId, browser.token);
    const poll = await (await post('/handoff/poll', { handle: start.handle })).json(); assert.equal(poll.status, 'approved'); assert.equal('centralToken' in poll, false);
    assert.equal((await post('/handoff/finish', { handle: start.handle })).status, 409);
    assert.equal((await post('/handoff/link', { handle: start.handle })).status, 401);
    assert.equal((await post('/handoff/link', { handle: start.handle }, 'local-one')).status, 204);
    const again = await (await post('/handoff/start', {})).json(); accounts.approveHandoff(new URL(again.url).hash.slice(1), browser.token);
    assert.equal((await (await post('/handoff/poll', { handle: again.handle })).json()).status, 'approved');
    const finish = await post('/handoff/finish', { handle: again.handle, deviceId: 'desktop-123' }); assert.equal(finish.status, 200); assert.equal((await finish.json()).user.id, 1);
    const desktop = await (await post('/handoff/start', {})).json(); accounts.approveHandoff(new URL(desktop.url).hash.slice(1), browser.token);
    assert.equal((await (await post('/handoff/poll', { handle: desktop.handle })).json()).status, 'approved');
    assert.equal((await post('/handoff/link-desktop', { handle: desktop.handle, secret: 'wrong' })).status, 401);
    await require('../services/planLedger').ensurePlanLedger(prisma);
    db.prepare('INSERT INTO PlanTrial VALUES (?, ?, ?)').run('desktop-local', 'ocr', 1000);
    db.prepare('INSERT INTO PlanTrial VALUES (?, ?, ?)').run('user:1', 'ocr', 2000);
    db.prepare('INSERT INTO PlanUsage VALUES (?, ?, ?, ?, ?)').run('desktop-local', 'cameraScan', 'scan-1', 2, 3000);
    const linkedDesktop = await post('/handoff/link-desktop', { handle: desktop.handle, secret: 'correct-secret', deviceId: 'desktop-123' });
    assert.equal(linkedDesktop.status, 200); assert.equal((await linkedDesktop.json()).user.id, 1);
    assert.equal(db.prepare('SELECT startedAt FROM PlanTrial WHERE ownerKey = ? AND feature = ?').get('user:1', 'ocr').startedAt, 1000);
    assert.equal(db.prepare('SELECT amount FROM PlanUsage WHERE ownerKey = ? AND operationId = ?').get('user:1', 'scan-1').amount, 2);
    await accounts.register('new@example.com', 'another-password'); await accounts.verifyEmail(emailCode, 'another-password');
    const newBrowser = await accounts.login('new@example.com', 'another-password');
    const newRequest = await (await post('/handoff/start', {})).json(); accounts.approveHandoff(new URL(newRequest.url).hash.slice(1), newBrowser.token);
    assert.equal((await (await post('/handoff/poll', { handle: newRequest.handle })).json()).status, 'approved');
    assert.equal((await post('/handoff/create-local', { handle: newRequest.handle })).status, 400);
    const created = await post('/handoff/create-local', { handle: newRequest.handle, deviceId: 'new-desktop', localPassword: 'offline-password' });
    assert.equal(created.status, 201); assert.equal((await created.json()).user.id, 2);
  } finally { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => centralServer.close(resolve)); db.close(); centralDb.close(); if (previous === undefined) delete process.env.ETECZKA_CENTRAL_ACCOUNT_URL; else process.env.ETECZKA_CENTRAL_ACCOUNT_URL = previous; }
});
