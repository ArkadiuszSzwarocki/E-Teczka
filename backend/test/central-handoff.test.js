const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createCentralHandoffs } = require('../services/centralHandoff');
const { createAccountService } = require('./helpers/centralAccounts');
const { createHttpApp } = require('../../central-accounts/httpApp');

test('desktop handoff uses explicit browser confirmation and keeps token on backend', async () => {
  const db = new DatabaseSync(':memory:'); let emailCode;
  const accounts = createAccountService({ db, sendVerification: async (_email, code) => { emailCode = code; }, verifyGoogle: async () => {} });
  await accounts.register('owner@example.com', 'test-password'); await accounts.verifyEmail(emailCode, 'test-password');
  const browser = await accounts.login('owner@example.com', 'test-password');
  const server = createHttpApp(accounts).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options) => fetch(String(url).replace('https://accounts.example.com', local), options);
  const handoffs = createCentralHandoffs(request);
  try {
    const start = await handoffs.start('https://accounts.example.com');
    assert.match(start.displayCode, /^\d{6}$/); assert.equal((await handoffs.poll(start.handle)).status, 'pending');
    const requestId = new URL(start.url).hash.slice(1);
    assert.equal((await accounts.inspectHandoff(requestId)).displayCode, start.displayCode);
    await accounts.approveHandoff(requestId, browser.token);
    const result = await handoffs.poll(start.handle); assert.equal(result.status, 'approved'); assert.equal(result.user.email, 'owner@example.com');
    assert.equal('centralToken' in result, false);
    assert.equal((await handoffs.take(start.handle)).user.id, browser.user.id);
    handoffs.finish(start.handle); await assert.rejects(handoffs.take(start.handle), /EXPIRED/);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});

test('login startup retries a transient outage once and reports rate limiting without repeated attempts',async()=>{
 let calls=0;const request=async()=>{calls++;if(calls===1)return new Response('{}',{status:503});return Response.json({requestId:'r'.repeat(43),displayCode:'123456',expiresAt:Date.now()+300000});};
 const handoffs=createCentralHandoffs(request);const result=await handoffs.start('https://accounts.example.com');assert.ok(result.handle);assert.equal(calls,2);
 let limited=0;const rate=createCentralHandoffs(async()=>{limited++;return Response.json({error:'limit'},{status:429,headers:{'Retry-After':'42'}});});await assert.rejects(rate.start('https://accounts.example.com'),error=>error.code==='CENTRAL_RATE_LIMIT'&&error.retryAfter===42);assert.equal(limited,1);
 const offline=createCentralHandoffs(async()=>{throw new TypeError('fetch failed');});await assert.rejects(offline.start('https://accounts.example.com'),error=>error.code==='CENTRAL_CONNECTION_FAILED');
});
