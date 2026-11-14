const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.AUTH_SECRET ||= 'test-only-secret-for-backup-settings';
const { encrypt, decrypt } = require('../services/backupCrypto');
const { createBackupRouter } = require('../routes/backup');

test('personal NAS password is required for browsing and separate backup credentials stay restricted', async () => {
  let saved = { provider: 'webdav', endpoint: 'https://nas.example:5001', remoteFolder: 'folder', schedule: 'daily', encryptedCredentials: encrypt(JSON.stringify({ username: 'backup', password: 'secret', purpose: 'backup-only' })) };
  const prisma = { subscription: { findUnique: async () => ({ plan: 'premium', status: 'active' }) }, backupDestination: { findUnique: async () => saved, upsert: async ({ update }) => (saved = { ...saved, ...update }) } };
  const app = express(); app.use(express.json()); app.use('/api/backup', createBackupRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const oldFetch = global.fetch; let remoteCalls = 0;
  global.fetch = async (url, options) => { if (String(url).startsWith('https://')) { remoteCalls++; return new Response('<d:multistatus xmlns:d="DAV:"/>', { status: 207 }); } return oldFetch(url, options); };
  const base = `http://127.0.0.1:${server.address().port}/api/backup`; const post = (url, body, method = 'POST') => oldFetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const info = await (await oldFetch(base + '/destination')).json();
    assert.equal(info.backupUsername, 'backup'); assert.equal(info.backupCredentialSaved, true); assert.equal(JSON.stringify(info).includes('secret'), false);
    let response = await post('/destination', { provider: 'webdav', endpoint: saved.endpoint, username: 'human', backupUsername: 'backup', backupPassword: '', remoteFolder: 'new', schedule: 'daily' }, 'PUT');
    assert.equal(response.status, 200); assert.equal(JSON.parse(decrypt(saved.encryptedCredentials)).password, 'secret');
    response = await post('/webdav/folders', { endpoint: saved.endpoint, username: 'human', password: '' }); assert.equal(response.status, 400); assert.equal(remoteCalls, 0);
    response = await post('/webdav/folders', { endpoint: saved.endpoint, username: 'human', password: 'personal' }); assert.equal(response.status, 200); assert.equal(remoteCalls, 1);
    response = await post('/webdav/folders', { endpoint: 'https://other.example', username: 'user', password: '' }); assert.equal(response.status, 400); assert.equal(remoteCalls, 1);
    response = await post('/destination', { provider: 'webdav', endpoint: 'https://other.example', username: 'human', backupUsername: 'backup', backupPassword: '', schedule: 'daily' }, 'PUT'); assert.equal(response.status, 400); assert.equal(saved.endpoint, 'https://nas.example:5001');
    response = await post('/cloud/latest', {}); assert.equal(response.status, 400);
    response = await post('/destination', { provider: 'webdav', endpoint: saved.endpoint, username: 'human', backupUsername: 'human', backupPassword: 'personal', schedule: 'daily' }, 'PUT'); assert.equal(response.status, 400);
    response = await post('/destination', { provider: 'webdav', endpoint: saved.endpoint, username: 'human', password: 'personal', schedule: 'manual' }, 'PUT'); assert.equal(response.status, 200); assert.equal(saved.encryptedCredentials, null);
  } finally { global.fetch = oldFetch; await new Promise(resolve => server.close(resolve)); }
});
