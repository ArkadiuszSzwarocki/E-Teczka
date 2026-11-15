const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-catalog-'));process.chdir(sandbox);
process.env.ETECZKA_DEV_PLANS='1';process.env.NODE_ENV='development';
const {defaultCatalog,validateCatalog,saveCatalog,getCatalog,quote}=require('../services/planCatalog');
const policy=require('../services/planPolicy');const {createDeveloperCatalogRouter}=require('../routes/developerCatalog');
test('catalog validates, persists, updates limits and trials, and limits discounts to their date range',async()=>{
 const data=structuredClone(defaultCatalog);data.plans.free.limits.documents=123;data.usageDays=10;data.ocrTrialDays=3;
 data.promotions=[{id:'spring',name:'Test',plan:'premium',interval:'monthly',percent:20,startsAt:'2026-11-01T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',enabled:true}];
 assert.equal(quote('premium','monthly',new Date('2026-11-01T00:00:00Z'),data).amount,799);
 assert.equal(quote('premium','monthly',new Date('2026-12-01T00:00:00Z'),data).amount,999);
 const invalid=structuredClone(data);invalid.promotions[0].percent=101;assert.throws(()=>validateCatalog(invalid));
 invalid.promotions[0].percent=20;invalid.promotions[0].endsAt=invalid.promotions[0].startsAt;assert.throws(()=>validateCatalog(invalid));
 saveCatalog(data);policy.refreshPlanPolicy();assert.equal(policy.PLAN_LIMITS.free.documents,123);assert.equal(policy.USAGE_WINDOW_MS,10*86400000);
 assert.equal(policy.trialEnd('ocr',new Date('2026-11-01T00:00:00Z')).toISOString(),'2026-11-04T00:00:00.000Z');
 assert.equal(JSON.parse(fs.readFileSync(path.join(sandbox,'security','developer-plan-catalog.json'))).usageDays,10);
 const copy=getCatalog();copy.usageDays=999;assert.equal(getCatalog().usageDays,10);
 process.env.NODE_ENV='production';assert.equal(getCatalog().usageDays,7);process.env.NODE_ENV='development';
 saveCatalog(defaultCatalog);policy.refreshPlanPolicy();
});
test('developer catalog rejects remote origins and production, then accepts validated local saves',async()=>{
 const app=express();app.use(express.json());app.use('/catalog',createDeveloperCatalogRouter());
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url=`http://127.0.0.1:${server.address().port}/catalog`;
 try{
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url,{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(url,{headers:{origin:'http://127.0.0.1:5173'}})).status,200);
  assert.equal((await fetch(url,{method:'PUT',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:'{}'})).status,400);
  process.env.NODE_ENV='production';assert.equal((await fetch(url,{headers:{origin:'http://127.0.0.1:5173'}})).status,404);
 }finally{process.env.NODE_ENV='development';await new Promise(resolve=>server.close(resolve));}
});
