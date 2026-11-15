const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createCentralHandoffs } = require('../services/centralHandoff');
const { createAccountService } = require('../../central-accounts/accountService');
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
    assert.equal(accounts.inspectHandoff(requestId).displayCode, start.displayCode);
    accounts.approveHandoff(requestId, browser.token);
    const result = await handoffs.poll(start.handle); assert.equal(result.status, 'approved'); assert.equal(result.user.email, 'owner@example.com');
    assert.equal('centralToken' in result, false);
    assert.equal((await handoffs.take(start.handle)).user.id, browser.user.id);
    handoffs.finish(start.handle); await assert.rejects(handoffs.take(start.handle), /EXPIRED/);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
