const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
process.env.AUTH_SECRET ||= 'test-only-secret-for-backup-http-tests';
const { createBackupRouter, runScheduledCloudBackup } = require('../routes/backup');
const { decryptBackup, encrypt } = require('../services/backupCrypto');

test('manual export, cloud upload and scheduled backup generate readable ZIPs', async () => {
  const destination = { id: 1, ownerKey: 'desktop-local', enabled: true, schedule: 'daily', provider: 'webdav', endpoint: 'https://nas.example/dav', remoteFolder: 'backups', encryptedCredentials: encrypt(JSON.stringify({ username: 'backup', password: 'test', purpose: 'backup-only' })) };
  const prisma = { $executeRawUnsafe: async () => 0, $queryRaw: async () => [], folder: { findMany: async () => [{ id: 1, name: 'Test' }] }, document: { findMany: async () => [] }, subscription: { findUnique: async () => ({ plan: 'premium', status: 'active' }) }, backupDestination: { findUnique: async () => destination } };
  const app = express(); app.use(express.json()); app.use('/api/backup', createBackupRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const originalFetch = global.fetch; const uploads = [];
  global.fetch = async (url, options) => { if (String(url).startsWith('https://nas.example/')) { uploads.push(Buffer.from(options.body)); return new Response(null, { status: 201 }); } return originalFetch(url, options); };
  const base = `http://127.0.0.1:${server.address().port}/api/backup`;
  try {
    const exported = await originalFetch(`${base}/export`); assert.equal(exported.status, 200);
    const manifest = JSON.parse(new AdmZip(Buffer.from(await exported.arrayBuffer())).readAsText('manifest.json'));
    assert.equal(manifest.folders[0].name, 'Test');
    const uploaded = await originalFetch(`${base}/cloud`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'human', password: 'personal' }) }); assert.equal(uploaded.status, 200);
    assert.equal(await runScheduledCloudBackup(prisma, 'desktop-local', 1), true);
    assert.equal(uploads.length, 2);
    for (const bytes of uploads) assert.equal(JSON.parse(new AdmZip(decryptBackup(bytes)).readAsText('manifest.json')).folders[0].name, 'Test');
  } finally { global.fetch = originalFetch; await new Promise(resolve => server.close(resolve)); }
});
