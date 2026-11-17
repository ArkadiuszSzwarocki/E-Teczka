'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeMariaPool } = require('./mariadb/fakePool');
const { createMariaAccountService } = require('./mariadb/accountService');
const { createHttpApp } = require('./httpApp');
const { createTurnstileGate } = require('./turnstileGate');

test('HTTP flow confirms email, resets password and revokes sessions', async () => {
  const pool = createFakeMariaPool();
  let code;
  let reset;
  const accounts = createMariaAccountService({
    pool,
    sendVerification: async (_email, token) => { code = token; },
    sendPasswordReset: async (_email, token) => { reset = token; },
    verifyGoogle: async () => { throw new Error('not configured'); }
  });
  const server = createHttpApp(accounts).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, data, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
  try {
    assert.equal((await post('/register', { email: 'a@example.com', password: 'password1' })).status, 202);
    assert.equal((await post('/login', { email: 'a@example.com', password: 'password1' })).status, 401);
    assert.equal((await post('/verify-email', { token: code, password: 'password1' })).status, 200);
    const session = await (await post('/login', { email: 'a@example.com', password: 'password1' })).json();
    const headers = { authorization: `Bearer ${session.token}` };
    assert.equal((await fetch(base + '/me', { headers })).status, 200);
    assert.equal((await post('/request-password-reset', { email: 'a@example.com' })).status, 202);
    assert.equal((await post('/reset-password', { token: reset, password: 'newpassword1' })).status, 200);
    assert.equal((await fetch(base + '/me', { headers })).status, 401);
    assert.equal((await post('/reset-password', { token: reset, password: 'newpassword1' })).status, 400);
    const next = await (await post('/login', { email: 'a@example.com', password: 'newpassword1' })).json();
    assert.equal((await post('/logout', {}, { authorization: `Bearer ${next.token}` })).status, 204);
    const page = await fetch(base + '/verify');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    const accountPage = await fetch(base + '/account');
    assert.equal(accountPage.status, 200);
    assert.equal(accountPage.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(accountPage.headers.get('content-security-policy'), /style-src 'self' 'unsafe-inline' https:\/\/accounts.google.com\/gsi\/style/);
    assert.match(await accountPage.text(), /Utwórz konto/);
    assert.equal((await fetch(base + '/accountUi.js')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Google login requires an unused server challenge and Turnstile gate enforces token when configured', async () => {
  const pool = createFakeMariaPool();
  const accounts = createMariaAccountService({
    pool,
    sendVerification: async () => {},
    verifyGoogle: async (credential, nonce) => {
      if (credential !== 'valid' || !nonce) throw new Error('invalid');
      return { subject: 'google-sub', email: 'google@example.com', name: 'Google User' };
    }
  });
  const turnstileGate = createTurnstileGate({ secretKey: 'secret', verifyFn: async (_s, token) => token === 'ok-token' });
  const server = createHttpApp(accounts, { turnstileGate, turnstileSiteKey: 'site-key' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, data) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await post('/register', { email: 'bot@example.com', password: 'password1' })).status, 400);
    assert.equal((await post('/register', { email: 'bot@example.com', password: 'password1', turnstileToken: 'bad' })).status, 403);
    assert.equal((await post('/register', { email: 'human@example.com', password: 'password1', turnstileToken: 'ok-token' })).status, 202);
    const { nonce } = await (await post('/google-challenge', {})).json();
    assert.equal((await post('/google', { credential: 'valid', nonce })).status, 200);
    assert.equal((await post('/google', { credential: 'valid', nonce })).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
