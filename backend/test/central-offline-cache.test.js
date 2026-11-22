const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(),'mojateczka-offline-cache-')));process.env.AUTH_SECRET='isolated-offline-cache-test-key';
const {registerCentralDevice,centralPlanRequest,centralEntitlement}=require('../services/centralEntitlements');
const catalog=require('../../central-accounts/catalog.defaults.json');
test('offline snapshots cannot preserve paid access after downgrade or bypass explicit device revocation',async()=>{
 const keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),originalFetch=global.fetch,clock=Date.now;
 let now=clock(),deviceId,offline=false,revoked=false,plan='premium';Date.now=()=>now;
 const signed=()=>{const payload=Buffer.from(JSON.stringify({version:1,accountId:'a'.repeat(32),deviceId,kind:'desktop',plan,catalog,issuedAt:now,expiresAt:now+3600000,validUntil:null,deviceLimits:{desktop:null,mobile:1}})).toString('base64url');return {payload,publicKey,signature:crypto.sign(null,Buffer.from(payload),keys.privateKey).toString('base64url')};};
 global.fetch=async(url,options)=>{if(offline)throw new TypeError('network disconnected');if(url.endsWith('/public-key'))return {ok:true,json:async()=>({publicKey})};if(url.endsWith('/register'))deviceId=JSON.parse(options.body).deviceId;
  if(revoked)return {ok:false,status:401,json:async()=>({code:'DEVICE_REVOKED'})};
  let value=signed();if(url.endsWith('/ledger/status'))value={plan:'premium',catalog,allowance:{documents:null,tags:null}};
  if(url.endsWith('/ledger/trial'))value={allowed:true,startedAt:null,endsAt:null};return {ok:true,json:async()=>value};};
 try{
  await registerCentralDevice(21,'https://accounts.example.invalid','a'.repeat(32),'s'.repeat(43));
  await centralPlanRequest(21,'/ledger/status');await centralPlanRequest(21,'/ledger/trial',{feature:'ocr',start:false});
  plan='free';await centralEntitlement(21,true);offline=true;
  const cached=await centralPlanRequest(21,'/ledger/status');assert.equal(cached.offline,true);assert.equal(cached.plan,'free');assert.equal(cached.allowance.documents,catalog.plans.free.limits.documents);
  assert.equal((await centralPlanRequest(21,'/ledger/trial',{feature:'ocr',start:false})).allowed,false);
  now+=11000;offline=false;revoked=true;await assert.rejects(centralPlanRequest(21,'/ledger/status'));
  offline=true;await assert.rejects(centralPlanRequest(21,'/ledger/status'),/CENTRAL_ACCOUNT_REQUIRED/);
 }finally{global.fetch=originalFetch;Date.now=clock;}
});
