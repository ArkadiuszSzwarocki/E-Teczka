const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDatabasePool}=require('./database');
const {ensureEntitlementsSchema,createEntitlements}=require('./entitlements');
const {ensureLedgerSchema,createCentralLedger}=require('./planLedger');
const defaults=require('../catalog.defaults.json');
const op=value=>crypto.createHash('sha256').update(value).digest('hex');
test('four devices reserve disjoint offline pools; expired disconnected budgets stay held and settle exactly once',{skip:process.env.CENTRAL_MARIADB_INTEGRATION!=='1'},async()=>{
 const pool=createDatabasePool(),publicId=crypto.randomBytes(16).toString('hex');let id,now=Date.now();
 try{
  await ensureEntitlementsSchema(pool);await ensureLedgerSchema(pool);
  const [created]=await pool.execute('INSERT INTO accounts (public_id,email,verified,created_at) VALUES (?,?,1,?)',[publicId,`offline-${publicId}@example.invalid`,now]);id=created.insertId;
  const catalog=structuredClone(defaults);catalog.plans.free.accountDevices=4;catalog.plans.free.limits.cameraScan=12;catalog.plans.free.limits.documents=4;
  const catalogReader=async()=>structuredClone(catalog);
  const entitlements=createEntitlements({pool,now:()=>now,catalogReader,privateKey:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),getSession:async()=>({id:publicId,internal_id:id})});
  const credentials=Array.from({length:4},()=>crypto.randomBytes(32).toString('base64url'));
  for(let n=0;n<4;n++)await entitlements.register('session',{deviceId:`desktop-${n}`,credential:credentials[n],kind:'desktop'});
  const ledger=createCentralLedger({pool,now:()=>now,catalogReader});
  const grants=await Promise.all(credentials.map((credential,n)=>ledger.offline(credential,{poolId:op(`pool-${n}`),feature:'cameraScan',amount:4})));
  assert.equal(grants.reduce((sum,g)=>sum+g.remaining,0),12);assert.equal((await ledger.status(credentials[3])).cameraScan.remaining,0);
  const ownerIndex=grants.findIndex(g=>g.remaining>=2),owner=credentials[ownerIndex],grant=grants[ownerIndex],other=credentials[(ownerIndex+1)%4];assert.equal((await ledger.offline(owner,{poolId:grant.poolId,feature:'cameraScan',amount:4})).remaining,grant.remaining);
  await assert.rejects(ledger.reserve(credentials[3],{operationId:op('online-overspend'),feature:'cameraScan',amount:1}),/PLAN_LIMIT_REACHED/);
  now+=8*86400000;assert.equal((await ledger.status(owner)).cameraScan.used,12,'expiry and a new rolling period cannot reclaim unreported offline work');
  const operation={operationId:op('offline-scan'),poolId:grant.poolId,feature:'cameraScan',amount:2};
  await assert.rejects(ledger.settle(other,{action:'commit',operations:[operation.operationId],pooled:[operation]}),/INVALID_OPERATION/);
  const commit={action:'commit',operations:[operation.operationId],pooled:[operation]};await ledger.settle(owner,commit);await ledger.settle(owner,commit);
  assert.equal((await ledger.status(owner)).cameraScan.used,12);assert.equal((await ledger.offline(owner,{poolId:grant.poolId})).remaining,grant.remaining-2);
  await ledger.offline(owner,{poolId:grant.poolId,close:true});await ledger.settle(owner,commit);assert.equal((await ledger.status(owner)).cameraScan.used,12-(grant.remaining-2));
  await assert.rejects(ledger.settle(owner,{action:'commit',operations:[op('closed-spend')],pooled:[{...operation,operationId:op('closed-spend')}]}),/OFFLINE_POOL_EXHAUSTED/);
  const doc=await ledger.offline(owner,{poolId:op('doc-pool'),feature:'documents',amount:4});
  await assert.rejects(ledger.reserve(credentials[1],{operationId:op('doc-overspend'),feature:'documents',amount:1}),/PLAN_LIMIT_REACHED/);
  const docOperation={operationId:op('offline-doc'),poolId:doc.poolId,feature:'documents',amount:1};
  await ledger.settle(owner,{action:'commit',operations:[docOperation.operationId],pooled:[docOperation],inventory:{documents:1,tags:0,revision:1}});
  assert.equal((await ledger.status(owner)).documents.used,4,'inventory replaces a consumed reserved slot');
  await ledger.offline(owner,{poolId:doc.poolId,close:true});assert.equal((await ledger.status(owner)).documents.used,1);
  const cancelPool=await ledger.offline(owner,{poolId:op('cancel-pool'),feature:'merge',amount:2});
  await ledger.settle(owner,{action:'cancel',operations:[op('cancel')],pooled:[{operationId:op('cancel'),poolId:cancelPool.poolId,feature:'merge',amount:1}]});
  assert.equal((await ledger.offline(owner,{poolId:cancelPool.poolId})).remaining,2);
 }finally{if(id)await pool.execute('DELETE FROM accounts WHERE id=? AND public_id=?',[id,publicId]);await pool.end();}
});
