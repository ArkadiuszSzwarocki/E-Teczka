const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
process.env.AUTH_SECRET = 'central-account-router-test-secret';
const { createCentralAccountRouter: productionRouter } = require('../routes/centralAccount');
const createCentralAccountRouter=(...args)=>productionRouter(args[0],args[1],args[2],args[3],async()=>{});
const { createCentralHandoffs } = require('../services/centralHandoff');
const { verifyCentralSession } = require('../services/centralAccountLink');
const { createAccountService } = require('./helpers/centralAccounts');
const { createHttpApp } = require('../../central-accounts/httpApp');

test('central identity links only after both sessions and preserves the local account', async () => {
  const previous = process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL;
  process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = 'https://accounts.example.com';
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
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); if (previous === undefined) delete process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL; else process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = previous; }
});

test('desktop browser handoff links and later signs into existing local account', async () => {
  const previous = process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL; process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = 'https://accounts.example.com';
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
    const requestId = new URL(start.url).hash.slice(1); assert.equal((await accounts.inspectHandoff(requestId)).displayCode, start.displayCode);
    await accounts.approveHandoff(requestId, browser.token);
    const poll = await (await post('/handoff/poll', { handle: start.handle })).json(); assert.equal(poll.status, 'approved'); assert.equal('centralToken' in poll, false);
    assert.equal((await post('/handoff/finish', { handle: start.handle })).status, 409);
    assert.equal((await post('/handoff/link', { handle: start.handle })).status, 401);
    assert.equal((await post('/handoff/link', { handle: start.handle }, 'local-one')).status, 204);
    const again = await (await post('/handoff/start', {})).json(); await accounts.approveHandoff(new URL(again.url).hash.slice(1), browser.token);
    assert.equal((await (await post('/handoff/poll', { handle: again.handle })).json()).status, 'approved');
    const finish = await post('/handoff/finish', { handle: again.handle, deviceId: 'desktop-123' }); assert.equal(finish.status, 200); assert.equal((await finish.json()).user.id, 1);
    const desktop = await (await post('/handoff/start', {})).json(); await accounts.approveHandoff(new URL(desktop.url).hash.slice(1), browser.token);
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
    const newRequest = await (await post('/handoff/start', {})).json(); await accounts.approveHandoff(new URL(newRequest.url).hash.slice(1), newBrowser.token);
    assert.equal((await (await post('/handoff/poll', { handle: newRequest.handle })).json()).status, 'approved');
    assert.equal((await post('/handoff/create-local', { handle: newRequest.handle })).status, 400);
    const created = await post('/handoff/create-local', { handle: newRequest.handle, deviceId: 'new-desktop', localPassword: 'offline-password' });
    assert.equal(created.status, 201); assert.equal((await created.json()).user.id, 2);
  } finally { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => centralServer.close(resolve)); db.close(); centralDb.close(); if (previous === undefined) delete process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL; else process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = previous; }
});


test('registration bridge forwards only credentials and preserves upstream validation', async () => {
  const previous = process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL;
  let forwarded;
  const upstream = express(); upstream.use(express.json());
  upstream.post('/register', (req, res) => { forwarded = req.body; return res.status(req.body.email === 'invalid' ? 400 : 202).json(req.body.email === 'invalid' ? { error: 'Nieprawidłowy e-mail.' } : { message: 'Sprawdź pocztę.' }); });
  const upstreamServer = upstream.listen(0, '127.0.0.1'); await new Promise(resolve => upstreamServer.once('listening', resolve));
  process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = `http://127.0.0.1:${upstreamServer.address().port}`;
  const app = express(); app.use(express.json()); app.use('/bridge', createCentralAccountRouter({}));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const post = body => fetch(`http://127.0.0.1:${server.address().port}/bridge/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ email: 'a@example.com', password: 'short' })).status, 400);
    assert.equal(forwarded, undefined);
    const response = await post({ email: 'a@example.com', password: 'valid-password', verified: true });
    assert.equal(response.status, 202); assert.equal((await response.json()).message, 'Sprawdź pocztę.');
    assert.deepEqual(forwarded, { email: 'a@example.com', password: 'valid-password' });
    assert.equal((await post({ email: 'invalid', password: 'valid-password' })).status, 400);
    delete process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL;
    assert.equal((await post({ email: 'a@example.com', password: 'valid-password' })).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve)); await new Promise(resolve => upstreamServer.close(resolve));
    if (previous === undefined) delete process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL; else process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = previous;
  }
});


test('email credentials sign in without a browser code and preserve explicit local linking', async () => {
  const previous = process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL;
  const db = new DatabaseSync(':memory:'); let verification;
  const accounts = createAccountService({ db, sendVerification: async (_, code) => { verification = code; }, verifyGoogle: async () => {} });
  await accounts.register('direct@example.com', 'test-password'); await accounts.verifyEmail(verification);
  const upstream = createHttpApp(accounts).listen(0, '127.0.0.1'); await new Promise(resolve => upstream.once('listening', resolve));
  process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = `http://127.0.0.1:${upstream.address().port}`;
  const app = express(); app.use(express.json()); app.use('/bridge', createCentralAccountRouter({ $executeRawUnsafe: async () => 0, $queryRaw: async () => [] }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const post = (path, body) => fetch(`http://127.0.0.1:${server.address().port}/bridge${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/credentials', { email: 'direct@example.com', password: 'wrong' })).status, 401);
    const response = await post('/credentials', { email: 'direct@example.com', password: 'test-password' });
    assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.user.email, 'direct@example.com'); assert.ok(data.handle); assert.equal(data.token, undefined);
    const finish = await post('/handoff/finish', { handle: data.handle }); assert.equal(finish.status, 409); assert.equal((await finish.json()).code, 'LOCAL_LINK_REQUIRED');
    assert.equal(accounts.testPool.tables.sessions.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => upstream.close(resolve)); db.close(); if (previous === undefined) delete process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL; else process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = previous; }
});


test('password recovery sends mail only for a verified account and never discloses account existence', async () => {
  const previous = process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL;
  const db = new DatabaseSync(':memory:'); let code; let resetCount = 0; let resetToken;
  const accounts = createAccountService({ db, sendVerification: async (_, value) => { code = value; }, sendPasswordReset: async (_, value) => { resetCount++; resetToken = value; }, verifyGoogle: async () => {} });
  await accounts.register('recovery@example.com', 'old-password'); await accounts.verifyEmail(code);
  const oldSession = await accounts.login('recovery@example.com', 'old-password');
  const upstream = createHttpApp(accounts).listen(0, '127.0.0.1'); await new Promise(resolve => upstream.once('listening', resolve));
  process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = `http://127.0.0.1:${upstream.address().port}`;
  const app = express(); app.use(express.json()); app.use('/bridge', createCentralAccountRouter({}));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const post = email => fetch(`http://127.0.0.1:${server.address().port}/bridge/request-password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  try {
    const known = await post('recovery@example.com'), unknown = await post('missing@example.com');
    assert.equal(known.status, 202); assert.equal(unknown.status, 202); assert.deepEqual(await known.json(), await unknown.json()); assert.equal(resetCount, 1);
    assert.equal((await post('not-an-email')).status, 400);
    await accounts.resetPassword(resetToken, 'new-password'); assert.equal(await accounts.getSession(oldSession.token), null);
    await assert.rejects(accounts.resetPassword(resetToken, 'another-password'), /INVALID_TOKEN/);
    assert.equal((await accounts.login('recovery@example.com', 'new-password')).user.email, 'recovery@example.com');
  } finally { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => upstream.close(resolve)); db.close(); if (previous === undefined) delete process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL; else process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL = previous; }
});


test('a new verified user opens an isolated empty archive without previous PINs or local passwords', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE User(id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE,name TEXT,passwordHash TEXT); INSERT INTO User VALUES(1,'existing@example.com','Existing','unchanged'); CREATE TABLE Document(id INTEGER PRIMARY KEY,userId INTEGER,title TEXT); INSERT INTO Document VALUES(1,1,'Existing document');");
  const sql = strings => strings.join('?');
  const prisma = {
    $executeRawUnsafe: async value => { db.exec(value); return 0; },
    $executeRaw: async (strings,...args) => Number(db.prepare(sql(strings)).run(...args).changes),
    $queryRaw: async (strings,...args) => db.prepare(sql(strings)).all(...args),
    user: { findUnique: async ({where}) => where.email ? db.prepare('SELECT * FROM User WHERE email=?').get(where.email) : db.prepare('SELECT * FROM User WHERE id=?').get(where.id), create: async ({data}) => { const result=db.prepare('INSERT INTO User(email,name,passwordHash) VALUES(?,?,?)').run(data.email,data.name,data.passwordHash);return {id:Number(result.lastInsertRowid),email:data.email,name:data.name}; } },
    subscription: { findUnique: async () => null }, authSession: { findMany: async () => [], create: async () => ({}) }
  };
  prisma.$transaction = async fn => { db.exec('BEGIN');try{const value=await fn(prisma);db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;} };
  let email='new-user@example.com'; const handoffs={take:async()=>({origin:'https://accounts.example.com',user:{id:'b'.repeat(32),email,name:null}}),finish:()=>{}};
  const app=express();app.use(express.json());app.use('/bridge',createCentralAccountRouter(prisma,undefined,handoffs));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const post=body=>fetch(`http://127.0.0.1:${server.address().port}/bridge/handoff/finish`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  try {
    const response=await post({handle:'verified',createNew:true,deviceId:'new-device'});assert.equal(response.status,200);const session=await response.json();assert.equal(session.user.email,email);assert.notEqual(session.user.id,1);assert.ok(session.token);
    assert.equal(db.prepare('SELECT count(*) AS n FROM Document WHERE userId=?').get(session.user.id).n,0);
    assert.equal(db.prepare('SELECT title FROM Document WHERE userId=1').get().title,'Existing document');
    assert.equal(db.prepare('SELECT passwordHash FROM User WHERE id=1').get().passwordHash,'unchanged');
    assert.equal((await post({handle:'verified',createNew:true,deviceId:'new-device'})).status,200);assert.equal(db.prepare('SELECT count(*) AS n FROM User').get().n,2);
    db.prepare('DELETE FROM CentralAccountLink').run();email='existing@example.com';
    const conflict=await post({handle:'verified',createNew:true});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'LOCAL_ACCOUNT_EXISTS');assert.equal(db.prepare('SELECT count(*) AS n FROM CentralAccountLink').get().n,0);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
