const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { getPlanUsage } = require('../services/planUsage');
const { ensurePlanLedger, consumeUsage, featureTrial } = require('../services/planLedger');

test('usage reports owned documents, rolling limits and trials without starting them', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-usage-'));
 const db = new PrismaClient({datasources:{db:{url:`file:${path.join(dir,'test.db').replace(/\\/g,'/')}`}}});
 try {
  for (const sql of [
   "CREATE TABLE Subscription (id INTEGER PRIMARY KEY,ownerKey TEXT UNIQUE NOT NULL,provider TEXT NOT NULL DEFAULT 'stripe',providerCustomerId TEXT,providerSubscriptionId TEXT,plan TEXT NOT NULL DEFAULT 'free',status TEXT NOT NULL DEFAULT 'inactive',currentPeriodEnd DATETIME,cancelAtPeriodEnd BOOLEAN NOT NULL DEFAULT 0,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
   "CREATE TABLE Tag (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL DEFAULT '#2563eb',createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
   'CREATE TABLE Folder (id INTEGER PRIMARY KEY,name TEXT NOT NULL,parentId INTEGER,ownerId INTEGER NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"order" INTEGER NOT NULL DEFAULT 0,updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
   "CREATE TABLE Document (id INTEGER PRIMARY KEY,title TEXT NOT NULL,filePath TEXT NOT NULL,mimeType TEXT NOT NULL,folderId INTEGER NOT NULL,userId INTEGER,thumbnail TEXT,ocrText TEXT,retentionEnabled BOOLEAN NOT NULL DEFAULT 1,retentionValue INTEGER NOT NULL DEFAULT 5,retentionUnit TEXT NOT NULL DEFAULT 'years',isArchived BOOLEAN NOT NULL DEFAULT 0,isDeleted BOOLEAN NOT NULL DEFAULT 0,deletedAt DATETIME,physicalLocation TEXT,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
   'CREATE TABLE DocumentTag (documentId INTEGER NOT NULL,tagId INTEGER NOT NULL,PRIMARY KEY(documentId,tagId))',
   "INSERT INTO Folder(id,name,ownerId) VALUES(1,'first',1),(2,'second',2)",
   "INSERT INTO Document(id,title,filePath,mimeType,folderId,isDeleted) VALUES(1,'a','a','application/pdf',1,1),(2,'b','b','application/pdf',2,0)"
  ]) await db.$executeRawUnsafe(sql);
  await ensurePlanLedger(db);
  const now = new Date('2026-06-10T12:00:00Z'), used = new Date('2026-06-08T12:00:00Z');
  await db.$transaction(tx => consumeUsage(tx,'user:1','free','cameraScan','one',3,used));
  let result = await getPlanUsage(db,'user:1',1,now);
  assert.equal(result.documents.used,1); assert.equal(result.documents.remaining,199);
  assert.equal(result.cameraScan.used,3); assert.equal(result.cameraScan.remaining,47);
  assert.equal(result.cameraScan.nextRenewal.toISOString(),'2026-06-15T12:00:00.000Z');
  assert.equal(result.ocr.startedAt,null); assert.equal(result.cloudBackup.startedAt,null);
  await featureTrial(db,'user:1','ocr',true,used);
  result = await getPlanUsage(db,'user:1',1,now);
  assert.equal(result.ocr.allowed,true); assert.equal(result.ocr.endsAt.toISOString(),'2026-06-22T12:00:00.000Z');
  const other = await getPlanUsage(db,'user:2',2,now); assert.equal(other.cameraScan.used,0); assert.equal(other.ocr.startedAt,null);
  const expired = await getPlanUsage(db,'user:1',1,new Date('2026-06-23T12:00:00Z')); assert.equal(expired.cameraScan.used,0); assert.equal(expired.ocr.allowed,false);
  const {activeDocumentIds,activeTagIds}=require('../services/planRestrictions');
  for(let i=2;i<=202;i++) await db.$executeRaw`INSERT INTO Document(id,title,filePath,mimeType,folderId,createdAt) VALUES (${i+100},${'x'},${'p'},${'application/pdf'},${1},${new Date('2026-01-01T00:00:00Z')})`;
  let active=await activeDocumentIds(db,1,'free');assert.equal(active.size,200);assert.equal(active.has(302),false);
  await db.document.delete({where:{id:102}});active=await activeDocumentIds(db,1,'free');assert.equal(active.has(301),true);assert.equal(active.has(302),true);
  for(let i=1;i<=4;i++){await db.$executeRaw`INSERT INTO Tag(id,name,color) VALUES (${i},${'tag'+i},${'#fff'})`;await db.$executeRaw`INSERT INTO PlanTagOwner(ownerId,tagId) VALUES (${1},${i})`;}
  let activeTags=await activeTagIds(db,1,'free');assert.deepEqual([...activeTags],[1,2,3]);
  await db.$executeRaw`DELETE FROM PlanTagOwner WHERE ownerId=${1} AND tagId=${1}`;activeTags=await activeTagIds(db,1,'free');assert.deepEqual([...activeTags],[2,3,4]);assert.equal(await activeTagIds(db,1,'premium'),null);

 } finally { await db.$disconnect(); fs.rmSync(dir,{recursive:true,force:true}); }
});
