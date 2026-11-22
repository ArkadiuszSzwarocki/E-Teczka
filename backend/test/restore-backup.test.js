const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const crypto = require('node:crypto');
process.env.AUTH_SECRET = 'test-only-secret-for-backup-restore';
const { restoreBackup } = require('../services/restoreBackup.js');
const { readOcrText } = require('../services/ocrText.js');

function restoreTx(tx) {
  return { folderShare: { count: async () => 0 }, ...tx, folder: { count: async () => 0, findMany: async () => [], deleteMany: async () => ({}), ...tx.folder }, document: { findMany: async () => [], deleteMany: async () => ({}), ...tx.document } };
}

function backup(withFile = true) {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ version: 1, folders: [{ id: 1, name: 'A' }], documents: [{ id: 2, folderId: 1, title: 'Scan', filePath: 'scan.pdf', mimeType: 'application/pdf' }] })));
  if (withFile) zip.addFile('files/2-scan.pdf', Buffer.from('PDF sample'));
  return zip.toBuffer();
}

test('restore rejects missing document before changing the database', async () => {
  let transactions = 0;
  const prisma = { $transaction: async () => { transactions++; } };
  await assert.rejects(restoreBackup(prisma, backup(false), 7, 7), /Brak pliku dokumentu/);
  assert.equal(transactions, 0);
});

test('restore removes written files when the database transaction fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-restore-'));
  let folderWrites = 0;
  const prisma = { $transaction: async action => action(restoreTx({ folder: { create: async () => { folderWrites++; return { id: 11 }; } }, document: { create: async () => { throw new Error('database failed'); } } })) };
  try {
    await assert.rejects(restoreBackup(prisma, backup(), 7, 7, dir), /database failed/);
    assert.equal(folderWrites, 1);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmdirSync(dir); }
});

test('restore returns actual counts and saves document in owner folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-restore-'));
  let document;
  const prisma = { $transaction: async action => action(restoreTx({ folder: { create: async ({ data }) => { assert.equal(data.ownerId, 7); return { id: 11 }; } }, document: { create: async ({ data }) => { document = data; return { id: 22 }; } } })) };
  try {
    assert.deepEqual(await restoreBackup(prisma, backup(), 7, 7, dir), { restoredFolders: 1, restoredDocuments: 1 });
    assert.equal(document.folderId, 11);
    assert.equal(document.userId, 7);
    assert.equal(fs.readFileSync(path.join(dir, document.filePath), 'utf8'), 'PDF sample');
  } finally { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); }
});

test('restores a document encrypted on another installation with its recovery key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-restore-key-'));
  const key = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([cipher.update(backup()), cipher.final()]);
  const encrypted = Buffer.concat([Buffer.from('ETECZKA-BACKUP-1\n'), iv, cipher.getAuthTag(), payload]);
  let document;
  const prisma = { $transaction: async action => action(restoreTx({ folder: { create: async () => ({ id: 11 }) }, document: { create: async ({ data }) => { document = data; return { id: 22 }; } } })) };
  try {
    await assert.rejects(restoreBackup(prisma, encrypted, 7, 7, dir));
    assert.deepEqual(await restoreBackup(prisma, encrypted, 7, 7, dir, key), { restoredFolders: 1, restoredDocuments: 1 });
    assert.equal(fs.readFileSync(path.join(dir, document.filePath), 'utf8'), 'PDF sample');
  } finally { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); }
});

test('re-encrypts OCR from another installation when restoring a backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-restore-ocr-'));
  const oldKey = crypto.randomBytes(32); const textIv = crypto.randomBytes(12);
  const textCipher = crypto.createCipheriv('aes-256-gcm', oldKey, textIv);
  const ciphertext = Buffer.concat([textCipher.update('Wyszukiwana faktura', 'utf8'), textCipher.final()]);
  const oldText = `mojateczka-ocr-v1:${textIv.toString('base64url')}.${textCipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
  const zip = new AdmZip(backup()); const manifest = JSON.parse(zip.readAsText('manifest.json')); manifest.documents[0].ocrText = oldText; zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const backupIv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', oldKey, backupIv);
  const encrypted = Buffer.concat([cipher.update(zip.toBuffer()), cipher.final()]);
  const data = Buffer.concat([Buffer.from('ETECZKA-BACKUP-1\n'), backupIv, cipher.getAuthTag(), encrypted]);
  let saved;
  const prisma = { $transaction: async action => action(restoreTx({ folder: { create: async () => ({ id: 11 }) }, document: { create: async ({ data }) => { saved = data; return { id: 22 }; } } })) };
  try { await restoreBackup(prisma, data, 7, 7, dir, oldKey); assert.equal(readOcrText(saved.ocrText), 'Wyszukiwana faktura'); assert.notEqual(saved.ocrText, oldText); }
  finally { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); }
});
