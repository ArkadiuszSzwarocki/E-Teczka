const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createOcrRouter } = require('../routes/ocr');
const { protectOcrText } = require('../services/ocrText');

test('OCR search and text are restricted to Premium and the document owner', async () => {
  let plan = 'premium'; const queued = []; const encrypted = protectOcrText('Gwarancja ekspresu SERWIS');
  const prisma = {
    $executeRawUnsafe: async () => 0, $queryRaw: async () => [],
    subscription: { findUnique: async () => ({ plan, status: 'active' }) },
    document: {
      findMany: async ({ where }) => where.folder.ownerId === 1 && (!where.id || where.id.in.includes(7)) ? [{ id: 7, ocrText: encrypted }] : [],
      findFirst: async ({ where }) => where.id === 7 && where.folder.ownerId === 1 ? { id: 7 } : null,
      findUnique: async () => ({ ocrText: encrypted }),
    },
  };
  const queue = { enqueue: (id, owner) => queued.push({ id, owner }), status: () => ({ state: 'done', error: null }) };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { if (req.header('x-user') === '2') { res.locals.userId = 2; res.locals.billingOwnerKey = 'user:2'; } else res.locals.billingOwnerKey = req.header('x-device') ? 'device:paired' : 'desktop-local'; next(); }); app.use('/ocr', createOcrRouter(prisma, queue));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); const url = `http://127.0.0.1:${server.address().port}/ocr`;
  try {
    let response = await fetch(`${url}/search?q=serwis`); assert.equal(response.status, 200); assert.deepEqual((await response.json()).ids, [7]);
    response = await fetch(`${url}/7`); assert.equal((await response.json()).text, 'Gwarancja ekspresu SERWIS');
    response = await fetch(`${url}/7`, { headers: { 'x-user': '2' } }); assert.equal(response.status, 404);
    response = await fetch(`${url}/7`, { method: 'POST', headers: { 'x-device': '1' } }); assert.equal(response.status, 202); assert.deepEqual(queued, [{ id: 7, owner: 'desktop-local' }]);
    response = await fetch(`${url}/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: [7] }) }); assert.equal(response.status, 202); assert.equal((await response.json()).queued, 1);
    response = await fetch(`${url}/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user': '2' }, body: JSON.stringify({ documentIds: [7] }) }); assert.equal(response.status, 404);
    plan = 'standard'; response = await fetch(`${url}/search?q=serwis`); assert.equal(response.status, 402);
    response = await fetch(`${url}/7`); assert.equal(response.status, 402);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
