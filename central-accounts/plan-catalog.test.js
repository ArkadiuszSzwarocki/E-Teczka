const test=require('node:test'),assert=require('node:assert/strict');
const {validateCatalog}=require('./mariadb/planCatalog');const {createHttpApp}=require('./httpApp');const defaults=require('./catalog.defaults.json');
test('central catalog validates limits, promotions and periods; only the server administrator may update it',async()=>{
 let saved=structuredClone(defaults);const token='t'.repeat(43);const server=createHttpApp({}, {catalog:{get:async()=>saved,save:async value=>{saved=validateCatalog(value);return saved;},adminToken:token}}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const put=(value,key)=>fetch(base+'/admin/catalog',{method:'PUT',headers:{'content-type':'application/json',...(key?{authorization:`Bearer ${key}`}:{})},body:JSON.stringify(value)});
 try{
  const publicCatalog=await(await fetch(base+'/catalog')).json();assert.equal(JSON.stringify(publicCatalog).includes(token),false);
  assert.equal((await put(saved)).status,403);assert.equal((await put(saved,'x'.repeat(43))).status,403);
  const changed=structuredClone(defaults);changed.usageDays=10;changed.ocrTrialDays=8;changed.plans.standard.limits.cameraScan=160;changed.promotions=[{id:'winter',name:'Promocja',plan:'standard',interval:'monthly',percent:20,startsAt:'2026-12-01T00:00:00Z',endsAt:'2026-12-10T00:00:00Z',enabled:true}];
  assert.equal((await put(changed,token)).status,200);const actual=await(await fetch(base+'/catalog')).json();assert.equal(actual.usageDays,10);assert.equal(actual.plans.standard.limits.cameraScan,160);assert.equal(actual.promotions[0].percent,20);
  const bad=structuredClone(changed);bad.plans.free.monthly=100;assert.equal((await put(bad,token)).status,400);assert.equal(saved.plans.free.monthly,0);
  assert.throws(()=>validateCatalog({...changed,usageDays:0}),/INVALID_CATALOG/);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
