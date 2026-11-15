const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createShareApp}=require('../server');
test('encrypted links require authorization, respect PIN, expiry, single-use and revocation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-share-'));const secret=crypto.randomBytes(32).toString('base64url'), key=crypto.randomBytes(32).toString('hex');let time=Date.now();
 const app=createShareApp({dataDir:dir,masterKey:key,publisherSecret:secret,publicBase:'https://shares.example.test',now:()=>time});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
 const publish=async body=>fetch(base+'/admin/shares',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(body)});const body={content:Buffer.from('private test data').toString('base64'),mimeType:'application/pdf',expiresInSeconds:3600,pin:'123456'};
 const redeem=(token,pin)=>fetch(base+'/public/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,pin})});
 try{
  assert.equal((await fetch(base+'/admin/shares',{method:'POST'})).status,401);
  let response=await publish(body);assert.equal(response.status,201);const item=await response.json(),token=new URL(item.url).hash.slice(1),raw=fs.readFileSync(path.join(dir,item.id+'.json'),'utf8');assert.equal(raw.includes('private test data'),false);assert.equal(raw.includes('123456'),false);assert.equal(raw.includes(token),false);
  assert.equal((await redeem(token,'000000')).status,403);response=await redeem(token,'123456');assert.equal(response.status,200);assert.equal(await response.text(),'private test data');
  for(let i=0;i<5;i++)await redeem(token,'000000');assert.equal((await redeem(token,'123456')).status,429);time+=16*60*1000;assert.equal((await redeem(token,'123456')).status,200);
  assert.equal((await fetch(base+'/admin/shares/'+item.id,{method:'DELETE',headers:{Authorization:`Bearer ${secret}`}})).status,204);assert.equal((await redeem(token,'123456')).status,404);
  const one=await(await publish({...body,singleUse:true})).json(),once=new URL(one.url).hash.slice(1);assert.equal((await redeem(once,'123456')).status,200);assert.equal((await redeem(once,'123456')).status,404);
  const expired=await(await publish(body)).json(),expiredToken=new URL(expired.url).hash.slice(1);time+=3600*1000;assert.equal((await redeem(expiredToken,'123456')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
