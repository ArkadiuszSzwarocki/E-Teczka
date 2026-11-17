const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createDatabasePool}=require('./database');const {ensureEntitlementsSchema,createEntitlements}=require('./entitlements');
test('MariaDB serializes concurrent device registrations and retains account-bound plans across devices',{skip:process.env.CENTRAL_MARIADB_INTEGRATION!=='1'},async()=>{
 const pool=createDatabasePool();const publicId=crypto.randomBytes(16).toString('hex');let id;
 try{
  await ensureEntitlementsSchema(pool);
  const [created]=await pool.execute('INSERT INTO accounts (public_id,email,verified,created_at) VALUES (?,?,1,?)',[publicId,`integration-${publicId}@example.invalid`,Date.now()]);id=created.insertId;
  const service=createEntitlements({pool,privateKey:crypto.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),getSession:async raw=>raw==='test-session'?{id:publicId,internal_id:id}:null});
  const devices=[1,2].map(n=>({deviceId:`test-desktop-${n}`,credential:crypto.randomBytes(32).toString('base64url'),kind:'desktop'}));
  const concurrent=await Promise.allSettled(devices.map(d=>service.register('test-session',d)));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(concurrent.filter(r=>r.status==='rejected'&&r.reason.message==='DEVICE_LIMIT_REACHED').length,1);
  const phone={deviceId:'test-mobile-one',credential:crypto.randomBytes(32).toString('base64url'),kind:'mobile'};
  await service.register('test-session',phone);
  await assert.rejects(service.register('test-session',{deviceId:'test-mobile-two',credential:crypto.randomBytes(32).toString('base64url'),kind:'mobile'}),/DEVICE_LIMIT_REACHED/);
  const free=await service.list('test-session');assert.equal(free.devices.filter(d=>d.kind==='desktop').length,1);assert.equal(free.devices.filter(d=>d.kind==='mobile').length,1);
  const desktop=devices[concurrent.findIndex(r=>r.status==='fulfilled')];
  assert.equal(JSON.parse(Buffer.from((await service.refresh(desktop.credential)).payload,'base64url').toString()).plan,'free');
  assert.equal(JSON.parse(Buffer.from((await service.refresh(phone.credential)).payload,'base64url').toString()).plan,'free');
  await pool.execute("UPDATE account_plans SET plan='standard',valid_until=? WHERE account_id=?",[Date.now()+600000,id]);
  for(const device of devices){const lease=await service.register('test-session',device);const data=JSON.parse(Buffer.from(lease.payload,'base64url').toString());assert.equal(data.plan,'standard');assert.equal(data.accountId,publicId);}
  assert.equal((await service.list('test-session')).devices.length,3);
  await service.revoke('test-session',devices[0].deviceId);await assert.rejects(service.refresh(devices[0].credential),/DEVICE_REVOKED/);
 }finally{if(id)await pool.execute('DELETE FROM accounts WHERE id=? AND public_id=?',[id,publicId]);await pool.end();}
});
