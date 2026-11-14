const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { PrismaClient } = require('@prisma/client');
const { createDocumentRouter } = require('../routes/documents.js');

async function main() {
  let prisma = {
    folder: { findFirst: async () => ({ id: 2, parentId: 1 }), findUnique: async () => ({ parentId: 1 }) },
    subscription: { findUnique: async () => null },
    $executeRawUnsafe: async () => 0, $executeRaw: async () => 1, $queryRaw: async strings => strings.join('?').includes('SUM(amount)') ? [{ used: 0, oldest: null }] : [],
    document: { findMany: async () => [], count: async () => 0, create: async ({ data }) => { if (data.title === 'fail.pdf') throw new Error('simulated database failure'); return { id: 1, ...data }; } },
  };
  prisma.$transaction = async fn => fn(prisma);
  if (process.env.ETECZKA_UPLOAD_TEST_SQLITE === '1') {
    prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(process.cwd(), 'test.db').replace(/\\/g, '/')}` } } });
    await prisma.$executeRawUnsafe('CREATE TABLE Folder (id INTEGER PRIMARY KEY, name TEXT NOT NULL, parentId INTEGER, ownerId INTEGER NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "order" INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await prisma.$executeRawUnsafe('CREATE TABLE Subscription (id INTEGER PRIMARY KEY, ownerKey TEXT NOT NULL UNIQUE, provider TEXT NOT NULL DEFAULT \'stripe\', providerCustomerId TEXT, providerSubscriptionId TEXT, plan TEXT NOT NULL DEFAULT \'free\', status TEXT NOT NULL DEFAULT \'inactive\', currentPeriodEnd DATETIME, cancelAtPeriodEnd BOOLEAN NOT NULL DEFAULT 0, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await prisma.$executeRawUnsafe('CREATE TABLE Document (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(title != \'fail.pdf\'), filePath TEXT NOT NULL, mimeType TEXT NOT NULL, folderId INTEGER NOT NULL, userId INTEGER, thumbnail TEXT, ocrText TEXT, retentionEnabled BOOLEAN NOT NULL DEFAULT 1, retentionValue INTEGER NOT NULL DEFAULT 5, retentionUnit TEXT NOT NULL DEFAULT \'years\', isArchived BOOLEAN NOT NULL DEFAULT 0, isDeleted BOOLEAN NOT NULL DEFAULT 0, deletedAt DATETIME, physicalLocation TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await prisma.$executeRaw`INSERT INTO Folder (id, name, parentId, ownerId) VALUES (2, 'Test', 1, 1)`;
  }
  const app = express(); app.use(express.json()); app.use('/api/documents', createDocumentRouter(prisma));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const bytes = Buffer.from('%PDF-1.4 test');
    const invalid = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'good.pdf', data: `data:application/pdf;base64,${bytes.toString('base64')}` }, { name: 'bad.pdf', data: 'invalid' }], folderId: 2, retentions: [] }) });
    assert.equal(invalid.status, 400);
    const invalidBase64 = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'bad.pdf', data: 'data:application/pdf;base64,!!!!' }], folderId: 2, retentions: [] }) });
    assert.equal(invalidBase64.status, 400);
    assert.deepEqual(fs.readdirSync(path.join(process.cwd(), 'uploads')).filter(name => name !== '.scan-drafts'), []);
    const failedSave = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'fail.pdf', data: `data:application/pdf;base64,${bytes.toString('base64')}` }], folderId: 2, retentions: [] }) });
    assert.equal(failedSave.status, 500);
    assert.deepEqual(fs.readdirSync(path.join(process.cwd(), 'uploads')).filter(name => name !== '.scan-drafts'), []);
    const failedBatch = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['good.pdf', 'fail.pdf'].map(name => ({ name, data: `data:application/pdf;base64,${Buffer.from(name).toString('base64')}` })), folderId: 2, retentions: [] }) });
    assert.equal(failedBatch.status, 500);
    assert.deepEqual(fs.readdirSync(path.join(process.cwd(), 'uploads')).filter(name => name !== '.scan-drafts'), []);
    if (process.env.ETECZKA_UPLOAD_TEST_SQLITE === '1') assert.equal(await prisma.document.count(), 0);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'test.pdf', data: `data:application/pdf;base64,${bytes.toString('base64')}` }], folderId: 2, retentions: [] }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.savedDocs.length, 1);
    assert.deepEqual(fs.readFileSync(path.join(process.cwd(), 'uploads', data.savedDocs[0].filePath)), bytes);
    if (process.env.ETECZKA_UPLOAD_TEST_SQLITE === '1') {
      const post = (items, folderId=2) => fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({files:items,folderId,retentions:[]})});
      const item = (name, value=bytes) => ({name,data:`data:application/pdf;base64,${value.toString('base64')}`});
      let duplicate=await post([item('inna-nazwa.pdf')]); assert.equal(duplicate.status,200); let report=await duplicate.json(); assert.equal(report.savedDocs.length,0); assert.equal(report.skippedDuplicates.length,1); assert.equal(await prisma.document.count(),1);
      duplicate=await post([item('first.pdf',Buffer.from('new-content')),item('second.pdf',Buffer.from('new-content'))]); assert.equal(duplicate.status,200); report=await duplicate.json();assert.equal(report.savedDocs.length,1);assert.equal(report.skippedDuplicates[0].name,'second.pdf');assert.equal(await prisma.document.count(),2);await prisma.document.delete({where:{id:report.savedDocs[0].id}});fs.unlinkSync(path.join(process.cwd(),'uploads',report.savedDocs[0].filePath));
      await prisma.$executeRaw`INSERT INTO Folder (id,name,parentId,ownerId) VALUES (3,'Other',1,1)`;
      const other=await post([item('second-folder.pdf')],3); assert.equal(other.status,200); const saved=await other.json();
      const move=await fetch(`http://127.0.0.1:${server.address().port}/api/documents/${saved.savedDocs[0].id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({folderId:2})});assert.equal(move.status,409);assert.equal((await move.json()).code,'DUPLICATE_DOCUMENT');
      await prisma.document.delete({where:{id:saved.savedDocs[0].id}});fs.unlinkSync(path.join(process.cwd(),'uploads',saved.savedDocs[0].filePath));
    }

    // Keep stored files available for duplicate detection until the test ends.
    const source = await PDFDocument.create(); source.addPage();
    const encoded = Buffer.from(await source.save()).toString('base64');
    const merge = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [1, 2].map(i => ({ name: `${i}.pdf`, data: `data:application/pdf;base64,${encoded}` })), folderId: 2, retentions: [], isMerge: true, mergedTitle: 'Scalony', mergedRetention: { enabled: true, value: 1, unit: 'years' } }) });
    assert.equal(merge.status, 200);
    const merged = await merge.json(); assert.equal(merged.savedDocs.length, 1);
    const mergedPath = path.join(process.cwd(), 'uploads', merged.savedDocs[0].filePath);
    assert.equal((await PDFDocument.load(fs.readFileSync(mergedPath))).getPageCount(), 2);

    if (process.env.ETECZKA_UPLOAD_TEST_SQLITE === '1') {
      fs.writeFileSync(path.join(process.cwd(),'uploads','quota.pdf'),'quota');
      for (let i = 0; i < 198; i++) await prisma.$executeRaw`INSERT INTO Document(title,filePath,mimeType,folderId) VALUES (${'quota'},${'quota.pdf'},${'application/pdf'},${2})`;
      const blocked = await fetch(`http://127.0.0.1:${server.address().port}/api/documents/upload-base64`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({files:[{name:'overflow.pdf',data:`data:application/pdf;base64,${Buffer.from('unique-overflow').toString('base64')}`}],folderId:2,retentions:[]}) });
      assert.equal(blocked.status,403); assert.equal((await blocked.json()).code,'PLAN_LIMIT_REACHED'); assert.equal(await prisma.document.count(),200); fs.unlinkSync(path.join(process.cwd(),'uploads','quota.pdf'));
    }
    fs.unlinkSync(path.join(process.cwd(), 'uploads', data.savedDocs[0].filePath)); fs.unlinkSync(mergedPath);
  } finally { await new Promise(resolve => server.close(resolve)); if (process.env.ETECZKA_UPLOAD_TEST_SQLITE === '1') await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
