const fs = require('node:fs');
const assert = require('node:assert/strict');
const express = require('express');
const { createScannerInboxRouter } = require('../routes/scannerInbox');

(async () => {
  const prisma = { $executeRawUnsafe: async () => 0, $executeRaw: async () => 1, $queryRaw: async () => [], subscription: { findUnique: async () => ({ plan: 'premium', status: 'active' }) }, folder: { findFirst: async () => ({ id: 2, ownerId: 1 }), findUnique: async () => ({ parentId: 1 }) }, document: { findMany: async ({select}) => select.filePath ? [] : [{ title: 'Test.pdf' }], create: async ({ data }) => ({ id: 7, ...data }) } };
  prisma.$transaction = async fn => fn(prisma);
  const app = express(); app.use(express.json({ limit: '50mb' })); app.use('/api/scanner', createScannerInboxRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const jpeg = fs.readFileSync(require('node:path').join(__dirname, 'fixtures/printer-page.jpg')).toString('base64');
    const base = `http://127.0.0.1:${server.address().port}/api/scanner`;
    const saved = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ data: `data:image/jpeg;base64,${jpeg}` }], title: 'Test', retention: { enabled: true, value: 5, unit: 'years' } }) });
    assert.equal(saved.status, 201); const info = await saved.json();
    const second = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ data: `data:image/jpeg;base64,${jpeg}` }], title: 'Test', retention: { enabled: true, value: 5, unit: 'years' } }) });
    assert.equal((await second.json()).title, 'Test (2).pdf');
    assert.equal((await (await fetch(base)).json()).length, 2);
    const renamed = await fetch(`${base}/${info.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Test (2)' }) });
    assert.equal(renamed.status, 200); assert.equal((await renamed.json()).title, 'Test (2) (2).pdf');
    const moved = await fetch(`${base}/${info.id}/move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folderId: 2 }) });
    assert.equal(moved.status, 200); assert.equal((await moved.json()).title, 'Test (2) (2).pdf');
    assert.equal((await (await fetch(base)).json()).length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
