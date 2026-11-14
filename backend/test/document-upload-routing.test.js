const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createDocumentRouter } = require('../routes/documents.js');

test('upload route is not mistaken for a document identifier', async () => {
  let documentLookups = 0;
  const prisma = { document: { findFirst: async () => { documentLookups++; return null; } }, folder: { findFirst: async () => null } };
  const app = express();
  app.use(express.json());
  app.use('/api/documents', createDocumentRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'test.pdf', data: 'data:application/pdf;base64,AA==' }], folderId: 1, retentions: [] }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /podkartoteki/);
    assert.equal(documentLookups, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('upload writes the original bytes in an isolated directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-upload-test-'));
  try {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'upload-child.js')], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    for (const relative of ['uploads/.scan-drafts', 'uploads', 'security', '']) {
      const target = path.join(dir, relative);
      if (fs.existsSync(target)) fs.rmdirSync(target);
    }
  }
});

test('upload rolls back the whole batch on a real SQLite constraint failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-upload-db-test-'));
  try {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'upload-child.js')], { cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, ETECZKA_UPLOAD_TEST_SQLITE: '1' } });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  } finally {
    const db = path.join(dir, 'test.db'); if (fs.existsSync(db)) fs.unlinkSync(db);
    for (const relative of ['uploads/.scan-drafts', 'uploads', 'security', '']) {
      const target = path.join(dir, relative); if (fs.existsSync(target)) fs.rmdirSync(target);
    }
  }
});
