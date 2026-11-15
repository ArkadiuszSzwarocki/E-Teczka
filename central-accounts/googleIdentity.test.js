'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleIdentityVerifier } = require('./googleIdentity');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('node:crypto');

test('passes the credential and configured audiences to Google verification', async () => {
  let request;
  const nonce = 'a'.repeat(43);
  const client = { verifyIdToken: async options => { request = options; return { getPayload: () => ({ sub: 'google-id', email: 'user@example.com', email_verified: true, nonce }) }; } };
  const verify = createGoogleIdentityVerifier({ audiences: ['client-a', 'client-b'], client });
  assert.deepEqual(await verify('credential', nonce), { provider: 'google', subject: 'google-id', email: 'user@example.com', name: null });
  await assert.rejects(verify('credential', 'b'.repeat(43)));
  assert.deepEqual(request, { idToken: 'credential', audience: ['client-a', 'client-b'] });
});

test('Google library verifies signature, audience, expiry and nonce with a local test key', async () => {
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const client = new OAuth2Client();
  client.getFederatedSignonCertsAsync = async () => ({ certs: { testkey: keys.publicKey.export({ type: 'spki', format: 'pem' }) }, format: 'PEM' });
  const nonce = 'c'.repeat(43); const now = Math.floor(Date.now() / 1000);
  const makeJwt = payload => {
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const message = `${part({ alg: 'RS256', kid: 'testkey', typ: 'JWT' })}.${part(payload)}`;
    return `${message}.${crypto.sign('RSA-SHA256', Buffer.from(message), keys.privateKey).toString('base64url')}`;
  };
  const claims = { iss: 'https://accounts.google.com', aud: 'client-id', sub: 'unique-id', email: 'a@example.com', email_verified: true, nonce, iat: now, exp: now + 3600 };
  const verify = createGoogleIdentityVerifier({ audiences: ['client-id'], client });
  assert.equal((await verify(makeJwt(claims), nonce)).subject, 'unique-id');
  await assert.rejects(verify(makeJwt({ ...claims, aud: 'other-client' }), nonce));
  await assert.rejects(verify(makeJwt({ ...claims, exp: now - 600 }), nonce));
  await assert.rejects(verify(makeJwt({ ...claims, nonce: 'd'.repeat(43) }), nonce));
  const jwt = makeJwt(claims); const parts = jwt.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'forged' })).toString('base64url');
  await assert.rejects(verify(parts.join('.'), nonce));
});

test('rejects unverified emails, malformed credentials and verification errors', async () => {
  assert.throws(() => createGoogleIdentityVerifier({ audiences: [] }));
  const verify = createGoogleIdentityVerifier({ audiences: ['client-a'], client: { verifyIdToken: async () => ({ getPayload: () => ({ sub: 'id', email: 'u@example.com', email_verified: false }) }) } });
  await assert.rejects(verify('token', 'a'.repeat(43)));
  await assert.rejects(verify(''));
  const rejected = createGoogleIdentityVerifier({ audiences: ['client-a'], client: { verifyIdToken: async () => { throw new Error('bad signature'); } } });
  await assert.rejects(rejected('token', 'a'.repeat(43)), /bad signature/);
});
