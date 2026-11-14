const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { createFolderRouter } = require('../routes/folders');

test('deleting folders preserves trashed and archived documents and protects other accounts', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-folders-'));
  const prisma=new PrismaClient({datasources:{db:{url:`file:${path.join(dir,'test.db').replace(/\\/g,'/')}`}}}); let server;
  try {
    await prisma.$executeRawUnsafe('CREATE TABLE Folder (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, parentId INTEGER, ownerId INTEGER NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "order" INTEGER NOT NULL DEFAULT 0, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(parentId) REFERENCES Folder(id) ON DELETE SET NULL)');
    await prisma.$executeRawUnsafe("CREATE TABLE Document (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, filePath TEXT NOT NULL, mimeType TEXT NOT NULL, folderId INTEGER NOT NULL, userId INTEGER, thumbnail TEXT, ocrText TEXT, retentionEnabled BOOLEAN NOT NULL DEFAULT 1, retentionValue INTEGER NOT NULL DEFAULT 5, retentionUnit TEXT NOT NULL DEFAULT 'years', isArchived BOOLEAN NOT NULL DEFAULT 0, isDeleted BOOLEAN NOT NULL DEFAULT 0, deletedAt DATETIME, physicalLocation TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(folderId) REFERENCES Folder(id))");
    const root=await prisma.folder.create({data:{name:'Do usunięcia',ownerId:1}});
    const child=await prisma.folder.create({data:{name:'Dziecko',ownerId:1,parentId:root.id}});
    const trash=await prisma.document.create({data:{title:'Kosz',filePath:'trash.pdf',mimeType:'application/pdf',folderId:child.id,isDeleted:true,deletedAt:new Date('2026-01-01')}});
    const archived=await prisma.document.create({data:{title:'Archiwum',filePath:'arch.pdf',mimeType:'application/pdf',folderId:child.id,isArchived:true}});
    const app=express();app.use(express.json());app.use('/api/folders',createFolderRouter(prisma));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}/api/folders`;
    const preview=await (await fetch(`${base}/${root.id}/delete-preview`)).json();assert.deepEqual([preview.documentCount,preview.archivedCount,preview.trashedCount],[0,1,1]);
    let response=await fetch(`${base}/${root.id}/delete-safely`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,409);assert.ok(await prisma.folder.findUnique({where:{id:root.id}}));const destRoot=await prisma.folder.create({data:{name:'Cel',ownerId:1}});const dest=await prisma.folder.create({data:{name:'Cel podrzędny',ownerId:1,parentId:destRoot.id}});response=await fetch(`${base}/${root.id}/delete-safely`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transferFolderId:dest.id})});assert.equal(response.status,200);const result=await response.json();assert.equal(result.preservedTrash,1);assert.equal(result.preservedArchived,1);
    assert.equal(await prisma.folder.findUnique({where:{id:root.id}}),null);assert.equal(await prisma.folder.findUnique({where:{id:child.id}}),null);
    const t=await prisma.document.findUnique({where:{id:trash.id}});const a=await prisma.document.findUnique({where:{id:archived.id}});assert.equal(t.isDeleted,true);assert.equal(t.deletedAt.toISOString(),'2026-01-01T00:00:00.000Z');assert.equal(a.isArchived,true);assert.equal(t.folderId,a.folderId);assert.equal(t.folderId,dest.id);assert.equal(await prisma.folder.count({where:{name:'Dokumenty z usuniętych kartotek'}}),0);
    const restored=await prisma.document.update({where:{id:trash.id},data:{isDeleted:false,deletedAt:null}});assert.equal(restored.folderId,result.targetFolderId);assert.equal(restored.filePath,'trash.pdf');
    const activeFolder=await prisma.folder.create({data:{name:'Aktywne',ownerId:1}});await prisma.document.create({data:{title:'Aktywny',filePath:'a.pdf',mimeType:'application/pdf',folderId:activeFolder.id}});
    response=await fetch(`${base}/${activeFolder.id}/delete-safely`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,409);assert.ok(await prisma.folder.findUnique({where:{id:activeFolder.id}}));
    const foreignRoot=await prisma.folder.create({data:{name:'Obcy',ownerId:2}});const foreignChild=await prisma.folder.create({data:{name:'Obcy cel',ownerId:2,parentId:foreignRoot.id}});
    response=await fetch(`${base}/${activeFolder.id}/delete-safely`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transferFolderId:foreignChild.id})});assert.equal(response.status,409);assert.equal(await prisma.document.count({where:{folderId:activeFolder.id}}),1);
    const foreignNested=await prisma.folder.create({data:{name:'Obce dziecko',ownerId:2,parentId:activeFolder.id}});
    response=await fetch(`${base}/${activeFolder.id}/delete-safely`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,409);assert.equal((await prisma.folder.findUnique({where:{id:foreignNested.id}})).parentId,activeFolder.id);
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();fs.rmSync(dir,{recursive:true,force:true});}
});
