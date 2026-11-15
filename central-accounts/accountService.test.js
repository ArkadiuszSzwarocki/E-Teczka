'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { createAccountService } = require('./accountService');

test('email registration requires one-time verification before login', async () => {
  const db = new DatabaseSync(':memory:'); let verification;
  const service = createAccountService({ db, sendVerification: async (email, code) => { verification = { email, code }; }, verifyGoogle: async () => {} });
  await service.register('User@example.com', 'test-password');
  assert.equal(verification.email, 'user@example.com');
  assert.notEqual(db.prepare('SELECT token_hash FROM verifications').get().token_hash, verification.code);
  assert.notEqual(db.prepare('SELECT password_hash FROM accounts').get().password_hash, 'test-password');
  await assert.rejects(service.login('user@example.com', 'test-password'), /INVALID_CREDENTIALS/);
  await service.verifyEmail(verification.code, 'test-password');
  await assert.rejects(service.verifyEmail(verification.code, 'test-password'), /INVALID_TOKEN/);
  await assert.rejects(service.login('user@example.com', 'wrong-password'), /INVALID_CREDENTIALS/);
  const session = await service.login('user@example.com', 'test-password');
  assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash, session.token);
  assert.equal(service.getSession(session.token).email, 'user@example.com');
  service.logout(session.token);
  assert.equal(service.getSession(session.token), null);
  db.close();
});

test('failed verification email does not leave an unusable account', async () => {
  const db = new DatabaseSync(':memory:');
  const service = createAccountService({ db, sendVerification: async () => { throw Error('SMTP unavailable'); }, verifyGoogle: async () => {} });
  await assert.rejects(service.register('user@example.com', 'test-password'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM accounts').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM verifications').get().n, 0);
  db.close();
});

test('new registration invalidates earlier links and keeps the latest registration password', async () => {
  const db = new DatabaseSync(':memory:'); let code; let messages = 0;
  const service = createAccountService({ db, sendVerification: async (_email, value) => { code = value; messages++; }, verifyGoogle: async () => {} });
  await service.register('owner@example.com', 'attacker-password');
  const oldCode = code;
  await service.register('owner@example.com', 'owner-password');
  assert.equal(messages, 2);
  await assert.rejects(service.verifyEmail(oldCode), /INVALID_TOKEN/);
  await service.verifyEmail(code);
  await assert.rejects(service.login('owner@example.com', 'attacker-password'), /INVALID_CREDENTIALS/);
  assert.equal((await service.login('owner@example.com', 'owner-password')).user.email, 'owner@example.com');
  db.close();
});

test('browser handoff requires confirmation, verifier, live session and is single use', async () => {
  const db = new DatabaseSync(':memory:'); let code; let clock = 100;
  const service = createAccountService({ db, now: () => clock, sendVerification: async (_email, value) => { code = value; }, verifyGoogle: async () => {} });
  await service.register('user@example.com', 'test-password'); await service.verifyEmail(code, 'test-password');
  const session = await service.login('user@example.com', 'test-password');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const request = service.startHandoff(challenge, 'Komputer');
  assert.equal(service.inspectHandoff(request.requestId).displayCode, request.displayCode);
  assert.equal(service.claimHandoff(request.requestId, verifier), null);
  assert.throws(() => service.approveHandoff(request.requestId, 'invalid'), /UNAUTHORIZED/);
  service.approveHandoff(request.requestId, session.token);
  assert.throws(() => service.claimHandoff(request.requestId, crypto.randomBytes(32).toString('base64url')), /INVALID_TOKEN/);
  assert.equal(service.claimHandoff(request.requestId, verifier).user.id, session.user.id);
  assert.throws(() => service.claimHandoff(request.requestId, verifier), /INVALID_TOKEN/);
  const second = service.startHandoff(challenge, 'Komputer'); service.approveHandoff(second.requestId, session.token); service.logout(session.token);
  assert.throws(() => service.claimHandoff(second.requestId, verifier), /INVALID_TOKEN/);
  const expired = service.startHandoff(challenge, 'Komputer'); clock = expired.expiresAt;
  assert.throws(() => service.inspectHandoff(expired.requestId), /INVALID_TOKEN/);
  db.close();
});

test('Google identity cannot take over an existing email account', async () => {
  const db = new DatabaseSync(':memory:');
  const service = createAccountService({ db, sendVerification: async () => {}, verifyGoogle: async () => ({ subject: 'google-sub', email: 'user@example.com', name: 'User' }) });
  await service.register('user@example.com', 'test-password');
  await assert.rejects(service.googleLogin('credential', service.createGoogleChallenge()), /ACCOUNT_LINK_REQUIRED/);
  db.close();
});

test('Google identity uses stable subject and expires sessions', async () => {
  const db = new DatabaseSync(':memory:'); let clock = 100;
  const service = createAccountService({ db, now: () => clock, sendVerification: async () => {}, verifyGoogle: async () => ({ subject: 'google-sub', email: 'user@example.com', name: 'User' }) });
  const nonce = service.createGoogleChallenge();
  const first = await service.googleLogin('credential', nonce);
  await assert.rejects(service.googleLogin('credential', nonce), /INVALID_CHALLENGE/);
  const second = await service.googleLogin('credential', service.createGoogleChallenge());
  assert.equal(first.user.id, second.user.id);
  clock = first.expiresAt;
  assert.equal(service.getSession(first.token), null);
  db.close();
});

test('resend restores verification and password reset invalidates all sessions', async () => {
  const db = new DatabaseSync(':memory:'); let code; let reset; let clock = 100;
  const service = createAccountService({ db, now: () => clock, sendVerification: async (_email, value) => { code = value; }, sendPasswordReset: async (_email, value) => { reset = value; }, verifyGoogle: async () => {} });
  await service.register('user@example.com', 'old-password');
  const expired = code; clock += 3600001;
  await assert.rejects(service.verifyEmail(expired, 'old-password'), /INVALID_TOKEN/);
  await service.resendVerification('user@example.com'); await service.verifyEmail(code, 'old-password');
  const session = await service.login('user@example.com', 'old-password');
  await service.requestPasswordReset('user@example.com');
  await service.resetPassword(reset, 'new-password');
  assert.equal(service.getSession(session.token), null);
  await assert.rejects(service.resetPassword(reset, 'new-password'), /INVALID_TOKEN/);
  await assert.rejects(service.login('user@example.com', 'old-password'), /INVALID_CREDENTIALS/);
  assert.equal((await service.login('user@example.com', 'new-password')).user.email, 'user@example.com');
  db.close();
});

test('linking Google requires an authenticated session and cannot steal an identity', async () => {
  const db = new DatabaseSync(':memory:'); let code;
  const service = createAccountService({ db, sendVerification: async (_email, value) => { code = value; }, verifyGoogle: async credential => ({ subject: credential, email: 'google@example.com', name: 'User' }) });
  const oldCode = code;
  await service.register('owner@example.com', 'owner-password'); await service.verifyEmail(code, 'owner-password');
  const owner = await service.login('owner@example.com', 'owner-password');
  await assert.rejects(service.linkGoogle('invalid', 'google-sub', service.createGoogleChallenge()), /UNAUTHORIZED/);
  await service.linkGoogle(owner.token, 'google-sub', service.createGoogleChallenge());
  assert.equal((await service.googleLogin('google-sub', service.createGoogleChallenge())).user.id, owner.user.id);
  await service.register('other@example.com', 'other-password'); await service.verifyEmail(code, 'other-password');
  const other = await service.login('other@example.com', 'other-password');
  await assert.rejects(service.linkGoogle(other.token, 'google-sub', service.createGoogleChallenge()), /IDENTITY_IN_USE/);
  db.close();
});
