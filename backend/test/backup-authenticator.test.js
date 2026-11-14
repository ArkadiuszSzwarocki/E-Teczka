const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSync } = require('otplib');
const { createBackupAuthenticator, verifyBackupAuthenticator, createBackupRecoveryCodes, matchBackupRecoveryCode } = require('../services/backupAuthenticator');

test('authenticator accepts a valid code and rejects replays and invalid codes', () => {
  const { secret, uri } = createBackupAuthenticator('konto testowe');
  assert.match(uri, /^otpauth:\/\/totp\//);
  const code = generateSync({ secret });
  const step = verifyBackupAuthenticator(secret, code);
  assert.equal(typeof step, 'number');
  assert.equal(verifyBackupAuthenticator(secret, code, step), null);
  assert.equal(verifyBackupAuthenticator(secret, 'invalid'), null);
});

test('recovery codes are random, stored as hashes and matched once by caller', () => {
  const { codes, hashes } = createBackupRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.notEqual(codes[0], hashes[0]);
  const index = matchBackupRecoveryCode(codes[0], hashes);
  assert.equal(index, 0);
  hashes.splice(index, 1);
  assert.equal(matchBackupRecoveryCode(codes[0], hashes), -1);
  assert.equal(matchBackupRecoveryCode('invalid', hashes), -1);
});
