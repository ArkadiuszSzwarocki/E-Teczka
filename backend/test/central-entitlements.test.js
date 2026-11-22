const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(),'mojateczka-entitlement-')));process.env.AUTH_SECRET='isolated-entitlement-test-key-not-production';
const {verifyEntitlement,registerCentralDevice,centralEntitlement}=require('../services/centralEntitlements');
test('entitlements bind account, device and key; offline use expires and explicit revocation invalidates the cache',async()=>{
 const keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
 const accountId='a'.repeat(32);let deviceId,offline=false,revoked=false;
 const signed=changes=>{const payload=Buffer.from(JSON.stringify({version:1,accountId,deviceId,kind:'desktop',plan:'premium',issuedAt:Date.now(),expiresAt:Date.now()+3600000,validUntil:Date.now()+7200000,deviceLimits:{desktop:null,mobile:1},...changes})).toString('base64url');return {payload,signature:crypto.sign(null,Buffer.from(payload),keys.privateKey).toString('base64url'),publicKey};};
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{assert.ok(url.startsWith('https://accounts.example.invalid/'));if(offline)throw new Error('offline');if(url.endsWith('/public-key'))return {ok:true,json:async()=>({publicKey})};if(url.endsWith('/register')){const body=JSON.parse(options.body);deviceId=body.deviceId;assert.equal(body.plan,undefined);return {ok:true,json:async()=>signed()};}if(revoked)return {ok:false,status:401,json:async()=>({code:'DEVICE_REVOKED'})};return {ok:true,json:async()=>signed()};};
 try{
  await registerCentralDevice(12,'https://accounts.example.invalid',accountId,'s'.repeat(43));
  const entry={accountId,deviceId,publicKey};assert.equal(verifyEntitlement(signed(),entry).plan,'premium');
  assert.throws(()=>verifyEntitlement({...signed(),signature:'forged'},entry));assert.throws(()=>verifyEntitlement(signed(),{...entry,accountId:'b'.repeat(32)}));assert.throws(()=>verifyEntitlement(signed(),{...entry,deviceId:'other-device'}));
  assert.throws(()=>verifyEntitlement(signed({expiresAt:Date.now()-1000}),entry));assert.throws(()=>verifyEntitlement(signed({expiresAt:Date.now()+2*86400000}),entry));
  offline=true;assert.equal((await centralEntitlement(12,true)).plan,'premium');
  offline=false;revoked=true;const denied=await centralEntitlement(12,true);assert.equal(denied.blocked,true);assert.equal(denied.plan,'free');
  offline=true;assert.equal((await centralEntitlement(12,true)).blocked,true);
 }finally{global.fetch=originalFetch;}
});
