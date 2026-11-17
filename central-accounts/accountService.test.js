'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeMariaPool } = require('./mariadb/fakePool');
const { createMariaAccountService } = require('./mariadb/accountService');

test('email registration requires one-time verification before login', async () => {
  const pool = createFakeMariaPool();
  let verification;
  const service = createMariaAccountService({
    pool,
    sendVerification: async (email, code) => { verification = { email, code }; },
    verifyGoogle: async () => {}
  });
  await service.register('User@example.com', 'test-password');
  assert.equal(verification.email, 'user@example.com');
  assert.notEqual(pool.tables.verifications[0].token_hash, verification.code);
  assert.notEqual(pool.tables.accounts[0].password_hash, 'test-password');
  await assert.rejects(service.login('user@example.com', 'test-password'), /INVALID_CREDENTIALS/);
  await service.verifyEmail(verification.code, 'test-password');
  await assert.rejects(service.verifyEmail(verification.code, 'test-password'), /INVALID_TOKEN/);
  await assert.rejects(service.login('user@example.com', 'wrong-password'), /INVALID_CREDENTIALS/);
  const session = await service.login('user@example.com', 'test-password');
  assert.notEqual(pool.tables.sessions[0].token_hash, session.token);
  assert.equal((await service.getSession(session.token)).email, 'user@example.com');
  await service.logout(session.token);
  assert.equal(await service.getSession(session.token), null);
});

test('failed verification email rolls back verification token', async () => {
  const pool = createFakeMariaPool();
  const service = createMariaAccountService({
    pool,
    sendVerification: async () => { throw new Error('SMTP unavailable'); },
    verifyGoogle: async () => {}
  });
  await assert.rejects(service.register('user@example.com', 'test-password'));
  assert.equal(pool.tables.verifications.length, 0);
});

test('password reset revokes existing sessions', async () => {
  const pool = createFakeMariaPool();
  let code;
  let reset;
  const service = createMariaAccountService({
    pool,
    sendVerification: async (_email, value) => { code = value; },
    sendPasswordReset: async (_email, value) => { reset = value; },
    verifyGoogle: async () => {}
  });
  await service.register('user@example.com', 'old-password');
  await service.verifyEmail(code, 'old-password');
  const session = await service.login('user@example.com', 'old-password');
  await service.requestPasswordReset('user@example.com');
  await service.resetPassword(reset, 'new-password');
  assert.equal(await service.getSession(session.token), null);
  await assert.rejects(service.login('user@example.com', 'old-password'), /INVALID_CREDENTIALS/);
  const next = await service.login('user@example.com', 'new-password');
  assert.equal((await service.getSession(next.token)).email, 'user@example.com');
});

test('a Google-created account can set an email password through a single-use link and keep Google login', async () => {
  const pool = createFakeMariaPool();
  let reset;
  const service = createMariaAccountService({ pool, sendPasswordReset: async (_email, value) => { reset = value; }, verifyGoogle: async () => ({ subject: 'new-google-sub', email: 'new@gmail.com' }) });
  const original = await service.googleLogin('credential', await service.createGoogleChallenge());
  await assert.rejects(service.login('new@gmail.com', 'new-password'), /INVALID_CREDENTIALS/);
  await service.requestPasswordReset('new@gmail.com');
  assert.ok(reset);
  await service.resetPassword(reset, 'new-password');
  const byPassword = await service.login('new@gmail.com', 'new-password');
  const byGoogle = await service.googleLogin('credential', await service.createGoogleChallenge());
  assert.equal(byPassword.user.id, original.user.id);
  assert.equal(byGoogle.user.id, original.user.id);
  assert.equal(await service.getSession(original.token), null);
  await assert.rejects(service.resetPassword(reset, 'another-password'), /INVALID_TOKEN/);
  reset = undefined;
  await service.requestPasswordReset('missing@gmail.com');
  assert.equal(reset, undefined);
});

test('Google login requires single-use challenge and links existing third-party email account explicitly', async () => {
  const pool = createFakeMariaPool();
  let code;
  const service = createMariaAccountService({
    pool,
    sendVerification: async (_email, value) => { code = value; },
    verifyGoogle: async () => ({ subject: 'google-sub', email: 'user@example.com', name: 'User' })
  });
  await service.register('user@example.com', 'test-password');
  await service.verifyEmail(code, 'test-password');
  const nonce = await service.createGoogleChallenge();
  await assert.rejects(service.googleLogin('token', nonce), /ACCOUNT_LINK_REQUIRED/);
  const session = await service.login('user@example.com', 'test-password');
  const linkNonce = await service.createGoogleChallenge();
  await service.linkGoogle(session.token, 'token', linkNonce);
  const googleSession = await service.googleLogin('token', await service.createGoogleChallenge());
  assert.equal(googleSession.user.email, 'user@example.com');
});

test('Google logs into a verified Gmail account without a second password and preserves its identity', async () => {
  const pool = createFakeMariaPool();
  let code;
  const service = createMariaAccountService({ pool, sendVerification: async (_email, value) => { code = value; }, verifyGoogle: async () => ({ subject: 'gmail-sub', email: 'test@gmail.com' }) });
  await service.register('test@gmail.com', 'test-password');
  await service.verifyEmail(code);
  const before = await service.login('test@gmail.com', 'test-password');
  const nonce = await service.createGoogleChallenge();
  const after = await service.googleLogin('credential', nonce);
  assert.equal(after.user.id, before.user.id);
  await assert.rejects(service.googleLogin('credential', nonce), /INVALID_CHALLENGE/);
  const again = await service.googleLogin('credential', await service.createGoogleChallenge());
  assert.equal(again.user.id, before.user.id);
});

test('Google takes ownership of a pending Gmail account and invalidates its unproven password and verification links', async () => {
  let oldCode;
  const service = createMariaAccountService({ pool: createFakeMariaPool(), sendVerification: async (_email, code) => { oldCode = code; }, verifyGoogle: async () => ({ subject: 'gmail-sub', email: 'test@gmail.com' }) });
  await service.register('test@gmail.com', 'test-password');
  const session = await service.googleLogin('credential', await service.createGoogleChallenge());
  assert.equal(session.user.email, 'test@gmail.com');
  await assert.rejects(service.login('test@gmail.com', 'test-password'), /INVALID_CREDENTIALS/);
  await assert.rejects(service.verifyEmail(oldCode), /INVALID_TOKEN/);
});
