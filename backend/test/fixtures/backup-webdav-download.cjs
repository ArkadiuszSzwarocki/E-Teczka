const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('route downloads the newest WebDAV backup using only its file name', async () => {
  const previous = process.cwd(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-webdav-test-')); process.chdir(dir);
  process.env.AUTH_SECRET = 'isolated-webdav-test-secret';
  const { createBackupRouter } = require('../../routes/backup');
  const destination = { enabled: true, provider: 'webdav', endpoint: 'https://nas.example/dav', remoteFolder: 'Kopie domowe' };
  const prisma = { subscription: { findUnique: async () => ({ plan: 'premium', status: 'active' }) }, backupDestination: { findUnique: async () => destination } };
  const app = express(); app.use(express.json()); app.use('/backup', createBackupRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const oldFetch = global.fetch; const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options.method === 'PROPFIND') return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Kopie%20domowe/kopia%20test.zip.enc</d:href><d:propstat><d:prop><d:resourcetype/><d:getlastmodified>Sat, 14 Nov 2026 10:00:00 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>', { status: 207 });
    return new Response(Buffer.from('encrypted backup'), { status: 200 });
  };
  try {
    const response = await oldFetch(`http://127.0.0.1:${server.address().port}/backup/cloud/latest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user', password: 'test' }) });
    assert.equal(response.status, 200); assert.equal(await response.text(), 'encrypted backup');
    assert.equal(calls[1].url, 'https://nas.example/dav/Kopie%20domowe/kopia%20test.zip.enc');
    assert.equal(calls[1].options.redirect, 'error');

    const selected = await oldFetch(`http://127.0.0.1:${server.address().port}/backup/cloud/latest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user', password: 'test', filename: 'starsza kopia.zip.enc' }) });
    assert.equal(selected.status, 200); assert.equal(await selected.text(), 'encrypted backup');
    assert.equal(calls[2].url, 'https://nas.example/dav/Kopie%20domowe/starsza%20kopia.zip.enc');
    assert.equal(calls[2].options.redirect, 'error');
  } finally { global.fetch = oldFetch; await new Promise(resolve => server.close(resolve)); process.chdir(previous); fs.rmSync(dir, { recursive: true, force: true }); }
});
