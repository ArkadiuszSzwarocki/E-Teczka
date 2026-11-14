const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { PrismaClient } = require('@prisma/client');
const { restoreBackup } = require('../services/restoreBackup');

function archive(title = 'Przywrócony') {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ version: 1, planState: { trials: [{ feature: 'ocr', startedAt: 1000 }], usage: [{ feature: 'merge', operationId: 'backup-op', amount: 1, usedAt: 2000 }] }, folders: [{id:1,name:'Rodzic',createdAt:'2020-01-01T00:00:00Z'},{id:2,name:'Dziecko',parentId:1}], documents: [{id:1,folderId:2,title,filePath:'doc.pdf',mimeType:'application/pdf',createdAt:'2021-01-01T00:00:00Z',retentionValue:2,retentionUnit:'years',isArchived:true}] })));
  zip.addFile('files/1-doc.pdf', Buffer.from('contents')); return zip.toBuffer();
}

test('restore replaces only the owner snapshot, remains idempotent and rolls back on failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-restore-sqlite-'));
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.join(dir, 'test.db').replace(/\\/g, '/')}` } } });
  try {
    await prisma.$executeRawUnsafe('CREATE TABLE Folder (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parentId INTEGER, ownerId INTEGER NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "order" INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(parentId) REFERENCES Folder(id) ON DELETE SET NULL)');
    await prisma.$executeRawUnsafe("CREATE TABLE Document (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK(title != 'FAIL'), filePath TEXT NOT NULL, mimeType TEXT NOT NULL, folderId INTEGER NOT NULL, userId INTEGER, thumbnail TEXT, ocrText TEXT, retentionEnabled BOOLEAN NOT NULL DEFAULT 1, retentionValue INTEGER NOT NULL DEFAULT 5, retentionUnit TEXT NOT NULL DEFAULT 'years', isArchived BOOLEAN NOT NULL DEFAULT 0, isDeleted BOOLEAN NOT NULL DEFAULT 0, deletedAt DATETIME, physicalLocation TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(folderId) REFERENCES Folder(id))");
    await prisma.$executeRawUnsafe("CREATE TABLE FolderShare (folderId INTEGER NOT NULL, userId INTEGER NOT NULL, permission TEXT NOT NULL DEFAULT 'VIEW', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(folderId,userId), FOREIGN KEY(folderId) REFERENCES Folder(id) ON DELETE CASCADE)");
    await prisma.$executeRawUnsafe('CREATE TABLE DocumentTag (documentId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY(documentId,tagId), FOREIGN KEY(documentId) REFERENCES Document(id) ON DELETE CASCADE)');
    await prisma.folder.create({data:{id:1,name:'Inny uzytkownik',ownerId:2}});
    await prisma.document.create({data:{id:1,title:'Cudzy',filePath:'other.pdf',mimeType:'application/pdf',folderId:1,userId:2}});
    await prisma.folder.create({data:{id:10,name:'Do zastapienia',ownerId:1}});
    await prisma.document.create({data:{id:10,title:'Stary',filePath:'old.pdf',mimeType:'application/pdf',folderId:10,userId:1}});
    fs.writeFileSync(path.join(dir,'old.pdf'),'old bytes');
    for (let n = 0; n < 2; n++) {
      await restoreBackup(prisma, archive(), 1, 1, dir);
      const { exportPlanState } = require('../services/planLedger'); const state = await exportPlanState(prisma, 'user:1'); assert.equal(state.trials[0].startedAt, 1000); assert.equal(state.usage.length, 1);
      const ownFolders = await prisma.folder.findMany({where:{ownerId:1},orderBy:{name:'asc'}});
      const ownDocs = await prisma.document.findMany({where:{folder:{ownerId:1}}});
      assert.equal(ownFolders.length,2); assert.equal(ownDocs.length,1);
      assert.equal(ownDocs[0].title,'Przywrócony'); assert.equal(ownDocs[0].isArchived,true);
      assert.equal(ownDocs[0].createdAt.toISOString(),'2021-01-01T00:00:00.000Z');
      assert.equal(ownDocs[0].retentionValue,2); assert.equal(fs.readFileSync(path.join(dir,ownDocs[0].filePath),'utf8'),'contents');
      assert.equal((await prisma.document.findUnique({where:{id:1}})).title,'Cudzy');
      assert.equal((await prisma.folder.findUnique({where:{id:1}})).ownerId,2);
    }
    const prior = await prisma.document.findFirst({where:{folder:{ownerId:1}}});
    const filesBefore = fs.readdirSync(dir).sort();
    await assert.rejects(restoreBackup(prisma, archive('FAIL'), 1, 1, dir));
    const after = await prisma.document.findFirst({where:{folder:{ownerId:1}}});
    assert.equal(after.id,prior.id); assert.equal(after.title,prior.title);
    assert.deepEqual(fs.readdirSync(dir).sort(),filesBefore);
    assert.equal(fs.readFileSync(path.join(dir,'old.pdf'),'utf8'),'old bytes');
    const parent = await prisma.folder.findFirst({where:{ownerId:1,parentId:null}});
    await prisma.folderShare.create({data:{folderId:parent.id,userId:2}});
    await assert.rejects(restoreBackup(prisma, archive(), 1, 1, dir), /udostępnione/);
    assert.equal(await prisma.folderShare.count({where:{folderId:parent.id}}),1);
    await prisma.folderShare.deleteMany({where:{folderId:parent.id}});
    await prisma.folder.create({data:{name:'Obca podkartoteka',ownerId:2,parentId:parent.id}});
    await assert.rejects(restoreBackup(prisma, archive(), 1, 1, dir), /innych użytkowników/);
    assert.equal((await prisma.folder.findFirst({where:{name:'Obca podkartoteka'}})).parentId,parent.id);
  } finally { await prisma.$disconnect(); fs.rmSync(dir,{recursive:true,force:true}); }
});
