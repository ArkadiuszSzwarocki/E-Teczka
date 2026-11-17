const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDatabasePool}=require('./database');const {ensureEntitlementsSchema,createEntitlements}=require('./entitlements');const {ensureCatalogSchema}=require('./planCatalog');const {ensureLedgerSchema,createCentralLedger}=require('./planLedger');const defaults=require('../catalog.defaults.json');
const op=value=>crypto.createHash('sha256').update(value).digest('hex');
test('MariaDB shares limits, inventory and trials across devices and atomically rejects concurrent overspending',{skip:process.env.CENTRAL_MARIADB_INTEGRATION!=='1'},async()=>{
 const pool=createDatabasePool(),publicId=crypto.randomBytes(16).toString('hex');let id;let now=Date.UTC(2026,0,31,12);
 try{
  await ensureEntitlementsSchema(pool);await ensureCatalogSchema(pool);await ensureLedgerSchema(pool);
  const [created]=await pool.execute('INSERT INTO accounts (public_id,email,verified,created_at) VALUES (?,?,1,?)',[publicId,`ledger-${publicId}@example.invalid`,Date.now()]);id=created.insertId;
  const entitlements=createEntitlements({pool,now:()=>now,privateKey:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),getSession:async raw=>raw==='test-session'?{id:publicId,internal_id:id}:null});
  const a=crypto.randomBytes(32).toString('base64url'),b=crypto.randomBytes(32).toString('base64url');await entitlements.register('test-session',{deviceId:'computer-test',credential:a,kind:'desktop'});await entitlements.register('test-session',{deviceId:'phone-test',credential:b,kind:'mobile'});
  const ledger=createCentralLedger({pool,now:()=>now,catalogReader:async()=>structuredClone(defaults)});
  await ledger.reserve(a,{operationId:op('bulk'),feature:'cameraScan',amount:49,plan:'premium'});await ledger.reserve(a,{operationId:op('bulk'),feature:'cameraScan',amount:49});
  await assert.rejects(ledger.reserve(a,{operationId:op('bulk'),feature:'cameraScan',amount:1}),/OPERATION_MISMATCH/);
  const attempts=await Promise.allSettled([ledger.reserve(a,{operationId:op('a-last'),feature:'cameraScan',amount:1}),ledger.reserve(b,{operationId:op('b-last'),feature:'cameraScan',amount:1})]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.message==='PLAN_LIMIT_REACHED').length,1);
  assert.equal((await ledger.status(a)).cameraScan.used,50);assert.equal((await ledger.status(b)).cameraScan.used,50);
  await ledger.settle(a,{action:'cancel',operations:[op('bulk')]});assert.equal((await ledger.status(b)).cameraScan.used,1);
  const winner=attempts[0].status==='fulfilled'?a:b,winnerOp=attempts[0].status==='fulfilled'?op('a-last'):op('b-last');await ledger.settle(winner,{action:'commit',operations:[winnerOp]});await ledger.settle(winner,{action:'cancel',operations:[winnerOp]});assert.equal((await ledger.status(a)).cameraScan.used,1);
  await ledger.settle(a,{action:'commit',operations:[],inventory:{documents:150,tags:2,revision:1}});await ledger.settle(b,{action:'commit',operations:[],inventory:{documents:40,tags:1,revision:1}});
  assert.equal((await ledger.status(b)).documents.used,190);await assert.rejects(ledger.reserve(a,{operationId:op('tag'),feature:'tags',amount:1}),/PLAN_LIMIT_REACHED/);
  await ledger.reserve(a,{operationId:op('docs'),feature:'documents',amount:10});await assert.rejects(ledger.reserve(b,{operationId:op('more'),feature:'documents',amount:1}),/PLAN_LIMIT_REACHED/);
  await ledger.settle(a,{action:'commit',operations:[op('docs')],inventory:{documents:160,tags:2,revision:2}});assert.equal((await ledger.status(b)).documents.used,200);
  await ledger.settle(a,{action:'commit',operations:[],inventory:{documents:0,tags:0,revision:1}});assert.equal((await ledger.status(a)).documents.used,200);
  await ledger.settle(a,{action:'commit',operations:[],inventory:{documents:150,tags:2,revision:3}});assert.equal((await ledger.status(a)).documents.remaining,10);
  const first=await ledger.trial(a,{feature:'ocr',start:true});now+=86400000;const other=await ledger.trial(b,{feature:'ocr',start:true});assert.equal(other.startedAt,first.startedAt);assert.equal(other.endsAt,first.endsAt);
  const cloud=await ledger.trial(b,{feature:'cloudBackup',start:true});assert.equal(new Date(cloud.endsAt).toISOString(),'2026-04-01T12:00:00.000Z');
  now+=15*86400000;assert.equal((await ledger.trial(b,{feature:'ocr',start:true})).allowed,false);assert.equal((await ledger.status(a)).cameraScan.used,0);
  const migration={batchId:op('legacy'),trials:[{feature:'ocr',startedAt:first.startedAt-86400000}],usage:[{feature:'merge',operationId:'old-merge',amount:2,usedAt:now}]};await ledger.migrate(a,migration);await ledger.migrate(a,migration);assert.equal((await ledger.status(b)).merge.used,2);assert.equal((await ledger.trial(b,{feature:'ocr',start:true})).startedAt,first.startedAt-86400000);
  await entitlements.revoke('test-session','phone-test');await assert.rejects(ledger.status(b),/DEVICE_REVOKED/);assert.equal((await ledger.status(a)).merge.used,2);
 }finally{if(id)await pool.execute('DELETE FROM accounts WHERE id=? AND public_id=?',[id,publicId]);await pool.end();}
});
