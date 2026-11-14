const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const previous = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = 'test-only-secret-for-backup-crypto';
const { encrypt, decrypt, encryptBackup, decryptBackup, exportRecoveryKey, importRecoveryKey } = require('../services/backupCrypto.js');
if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;

test('backup encryption round trips and detects tampering', () => {
  const plain = Buffer.from('test backup content');
  const encrypted = encryptBackup(plain);
  assert.deepEqual(decryptBackup(encrypted), plain);
  const modified = Buffer.from(encrypted); modified[modified.length - 1] ^= 1;
  assert.throws(() => decryptBackup(modified));
  assert.equal(decrypt(encrypt('test token')), 'test token');
});

test('encrypted recovery file restores an existing backup and rejects incorrect passwords', () => {
  const phrase = 'separate secure password';
  const recovery = exportRecoveryKey(phrase);
  assert.equal(recovery.includes('test-only-secret-for-backup-crypto'), false);
  const encrypted = encryptBackup(Buffer.from('documents'));
  assert.deepEqual(decryptBackup(encrypted, importRecoveryKey(recovery, phrase)), Buffer.from('documents'));
  assert.throws(() => importRecoveryKey(recovery, 'wrong password'));
  assert.throws(() => exportRecoveryKey('short'));
  const damaged = JSON.parse(recovery); damaged.tag = Buffer.alloc(16).toString('base64');
  assert.throws(() => importRecoveryKey(JSON.stringify(damaged), phrase));
});

test('recovery file decrypts a backup created with a different installation secret', () => {
  const child = execFileSync(process.execPath, ['-e', "const c=require('./services/backupCrypto');console.log(JSON.stringify({key:c.exportRecoveryKey('separate password 123'),backup:c.encryptBackup(Buffer.from('foreign backup')).toString('base64')}))"], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, AUTH_SECRET: 'different-installation-secret' }, encoding: 'utf8' });
  const payload = JSON.parse(child); const backup = Buffer.from(payload.backup, 'base64');
  assert.throws(() => decryptBackup(backup));
  assert.equal(decryptBackup(backup, importRecoveryKey(payload.key, 'separate password 123')).toString(), 'foreign backup');
});

test('backup encryption remains compatible with the previous format', () => {
  const secret = 'test-only-secret-for-backup-crypto';
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.alloc(12, 7);
  const plain = Buffer.from('existing backup');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const legacy = Buffer.concat([Buffer.from('ETECZKA-BACKUP-1\n'), iv, cipher.getAuthTag(), encrypted]);
  assert.deepEqual(decryptBackup(legacy), plain);
});
