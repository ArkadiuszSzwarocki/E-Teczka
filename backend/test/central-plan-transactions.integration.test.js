const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('local SQLite commits, rollbacks and lost acknowledgements reconcile with the central MariaDB ledger',{skip:process.env.CENTRAL_MARIADB_INTEGRATION!=='1'},async()=>{
 const oldCwd=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-central-tx-'));process.chdir(dir);process.env.AUTH_SECRET='isolated-central-transaction-test-secret';process.env.ETECZKA_CENTRAL_ACCOUNT_URL='';
 const {PrismaClient}=require('@prisma/client');const prisma=new PrismaClient({datasources:{db:{url:`file:${path.join(dir,'test.db').replace(/\\/g,'/')}`}}});
 const {createDatabasePool}=require('../../central-accounts/mariadb/database');const {ensureEntitlementsSchema,createEntitlements}=require('../../central-accounts/mariadb/entitlements');const {ensureCatalogSchema}=require('../../central-accounts/mariadb/planCatalog');const {ensureLedgerSchema,createCentralLedger}=require('../../central-accounts/mariadb/planLedger');const {createHttpApp}=require('../../central-accounts/httpApp');const defaults=require('../../central-accounts/catalog.defaults.json');
 const {registerCentralDevice,centralPlanRequest}=require('../services/centralEntitlements');const {instrumentPlanTransactions,bootstrapCentralPlan,recoverCentralPlanJournal,prepareCentralOffline,centralOfflineStatus}=require('../services/centralPlanLedger');const {ensurePlanLedger,consumeUsage,checkDocumentCapacity}=require('../services/planLedger');
 const pool=createDatabasePool(),publicId=crypto.randomBytes(16).toString('hex');let id,server;const originalFetch=global.fetch;
 try{
  await ensureEntitlementsSchema(pool);await ensureCatalogSchema(pool);await ensureLedgerSchema(pool);const [created]=await pool.execute('INSERT INTO accounts (public_id,email,verified,created_at) VALUES (?,?,1,?)',[publicId,`transaction-${publicId}@example.invalid`,Date.now()]);id=created.insertId;
  const entitlements=createEntitlements({pool,privateKey:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),catalogReader:async()=>structuredClone(defaults),getSession:async raw=>raw==='s'.repeat(43)?{id:publicId,internal_id:id}:null});
  server=createHttpApp({}, {entitlements,ledger:createCentralLedger({pool,catalogReader:async()=>structuredClone(defaults)})}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  await prisma.$executeRawUnsafe('CREATE TABLE Folder (id INTEGER PRIMARY KEY,name TEXT NOT NULL,parentId INTEGER,ownerId INTEGER NOT NULL,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"order" INTEGER NOT NULL DEFAULT 0,updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await prisma.$executeRawUnsafe("CREATE TABLE Document (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,filePath TEXT NOT NULL,mimeType TEXT NOT NULL,folderId INTEGER NOT NULL,userId INTEGER,thumbnail TEXT,ocrText TEXT,retentionEnabled BOOLEAN NOT NULL DEFAULT 1,retentionValue INTEGER NOT NULL DEFAULT 5,retentionUnit TEXT NOT NULL DEFAULT 'years',isArchived BOOLEAN NOT NULL DEFAULT 0,isDeleted BOOLEAN NOT NULL DEFAULT 0,deletedAt DATETIME,physicalLocation TEXT,createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await prisma.$executeRawUnsafe("INSERT INTO Folder(id,name,ownerId) VALUES(1,'test',7)");await ensurePlanLedger(prisma);instrumentPlanTransactions(prisma);await registerCentralDevice(7,origin,publicId,'s'.repeat(43));await bootstrapCentralPlan(prisma,7,false);
  const status=()=>centralPlanRequest(7,'/ledger/status');
  await prisma.$transaction(tx=>consumeUsage(tx,'user:7','free','cameraScan','success',2));assert.equal((await status()).cameraScan.used,2);
  await prisma.$transaction(tx=>consumeUsage(tx,'user:7','free','cameraScan','success',2));assert.equal((await status()).cameraScan.used,2);
  await assert.rejects(prisma.$transaction(async tx=>{await consumeUsage(tx,'user:7','free','cameraScan','rolled-back',3);throw new Error('local write failed');}),/local write failed/);assert.equal((await status()).cameraScan.used,2);
  const data={title:'Test',filePath:'test.pdf',mimeType:'application/pdf',folderId:1,userId:7};
  const document=await prisma.$transaction(async tx=>{await checkDocumentCapacity(tx,7,'free',1);return tx.document.create({data});});assert.equal((await status()).documents.used,1);
  await prisma.$transaction(tx=>tx.document.delete({where:{id:document.id}}));assert.equal((await status()).documents.used,0);
  global.fetch=async(url,options)=>{if(String(url).endsWith('/ledger/settle')&&JSON.parse(options.body).action==='cancel')throw new Error('connection lost');return originalFetch(url,options);};
  await assert.rejects(prisma.$transaction(async tx=>{await consumeUsage(tx,'user:7','free','cameraScan','crashed-rollback',3);throw new Error('rollback with offline acknowledgement');}),/rollback with offline/);global.fetch=originalFetch;assert.equal((await status()).cameraScan.used,5);await recoverCentralPlanJournal(prisma);assert.equal((await status()).cameraScan.used,2);
  global.fetch=async(url,options)=>{const response=await originalFetch(url,options);if(String(url).endsWith('/ledger/settle')){const body=JSON.parse(options.body);if(body.action==='commit'&&body.operations.length)throw new Error('acknowledgement lost after commit');}return response;};
  await prisma.$transaction(tx=>consumeUsage(tx,'user:7','free','merge','lost-ack',1));global.fetch=originalFetch;assert.equal((await status()).merge.used,1);await recoverCentralPlanJournal(prisma);assert.equal((await status()).merge.used,1);
  await prepareCentralOffline(prisma,7,{documents:2,tags:0,cameraScan:2,printerScan:0,merge:0});
  const beforeOffline=await status();
  global.fetch=async()=>{throw new TypeError('network disconnected');};
  await prisma.$transaction(tx=>consumeUsage(tx,'user:7','free','cameraScan','offline-success',1));
  await prisma.$transaction(async tx=>{await checkDocumentCapacity(tx,7,'free',1);return tx.document.create({data});});
  await assert.rejects(prisma.$transaction(async tx=>{await consumeUsage(tx,'user:7','free','cameraScan','offline-failed',1);throw new Error('offline rollback');}),/offline rollback/);
  assert.equal(centralOfflineStatus(7).pools.find(p=>p.feature==='cameraScan').available,0);
  await assert.rejects(prisma.$transaction(tx=>consumeUsage(tx,'user:7','free','cameraScan','offline-overspend',1)),/Pula offline/);
  assert.equal((await status()).offline,true,'last verified account snapshot remains readable offline');
  global.fetch=originalFetch;
  // Advance the circuit breaker, without waiting for an actual network timeout.
  const clock=Date.now;Date.now=()=>clock()+11000;
  try{await recoverCentralPlanJournal(prisma);await recoverCentralPlanJournal(prisma);
   assert.equal(centralOfflineStatus(7).pools.find(p=>p.feature==='cameraScan').available,1,'rolled-back debit is returned exactly once');
   const afterOffline=await status();assert.equal(afterOffline.cameraScan.used,beforeOffline.cameraScan.used);assert.equal(afterOffline.documents.used,beforeOffline.documents.used);
   global.fetch=async()=>{throw new TypeError('network disconnected');};Date.now=()=>clock()+2*86400000;
   await assert.rejects(prisma.$transaction(tx=>consumeUsage(tx,'user:7','free','cameraScan','expired-offline-pool',1)),/EXPIRED_ENTITLEMENT|Pula offline/);
   global.fetch=originalFetch;Date.now=()=>clock()+11000;
   const [rows]=await pool.execute("SELECT SUM(amount) AS used FROM plan_operations WHERE account_id=? AND feature='cameraScan' AND state='committed'",[id]);assert.equal(Number(rows[0].used),3);
  }finally{Date.now=clock;}
  const journal=JSON.parse(require('../services/backupCrypto').decrypt(fs.readFileSync(path.join(dir,'security','central-plan-journal.enc'),'utf8')));assert.equal(Object.keys(journal.entries).length,0);
 }finally{global.fetch=originalFetch;if(server)await new Promise(resolve=>server.close(resolve));if(id)await pool.execute('DELETE FROM accounts WHERE id=? AND public_id=?',[id,publicId]);await pool.end();await prisma.$disconnect();process.chdir(oldCwd);}
});
