const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const previousSecret = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = 'ocr-test-installation-secret';
const { createOcrQueue } = require('../services/ocrQueue');
const { readOcrText } = require('../services/ocrText');
if (previousSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previousSecret;

async function waitFor(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('OCR queue did not finish');
}

test('premium OCR is serialized, stored encrypted and duplicate jobs are not run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-queue-test-')); let recognized = 0; let stored;
  const prisma = { subscription: { findUnique: async () => ({ plan: 'premium', status: 'active' }) }, document: { findUnique: async ({ where }) => ({ id: where.id, filePath: 'document.png', mimeType: 'image/png', isDeleted: false }), updateMany: async ({ data }) => { stored = data.ocrText; return { count: 1 }; } } };
  const queue = createOcrQueue(prisma, { file: path.join(dir, 'queue.enc'), uploadsDirectory: dir, extract: async () => { recognized++; await new Promise(resolve => setTimeout(resolve, 20)); return 'Prywatny tekst FAKTURA'; } });
  try {
    queue.enqueue(7, 'desktop-local'); queue.enqueue(7, 'desktop-local');
    await waitFor(() => queue.status(7, 'desktop-local').state === 'done');
    assert.equal(recognized, 1); assert.ok(!stored.includes('FAKTURA')); assert.equal(readOcrText(stored), 'Prywatny tekst FAKTURA');
    assert.ok(!fs.readFileSync(path.join(dir, 'queue.enc'), 'utf8').includes('desktop-local'));
    assert.equal(queue.status(7, 'user:99').state, 'not_started');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('non-premium OCR stays paused and does not read documents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-queue-free-')); let called = false;
  const prisma = { $executeRawUnsafe: async () => 0, $queryRaw: async () => [], subscription: { findUnique: async () => ({ plan: 'standard', status: 'active' }) }, document: { findUnique: async () => { called = true; } } };
  const queue = createOcrQueue(prisma, { file: path.join(dir, 'queue.enc'), uploadsDirectory: dir, extract: async () => '' });
  try { queue.enqueue(8, 'desktop-local'); await waitFor(() => queue.status(8, 'desktop-local').state === 'paused'); assert.equal(called, false); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
