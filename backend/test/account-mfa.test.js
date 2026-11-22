const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'mojateczka-login-mfa-'));process.chdir(sandbox);process.env.AUTH_SECRET='isolated-login-mfa-test-secret-not-production';
const {generateSync}=require('otplib');const {createAccountSecurityRouter}=require('../routes/accountSecurity');const {accountMfa,AccountMfaRequired}=require('../services/accountMfa');const {createSession,passwordHash}=require('../routes/auth');
test('login MFA enrolls only after password and TOTP confirmation, blocks missing codes, and consumes recovery codes once',async()=>{
 let sessions=0,revoked=0,revokeFails=false;
 const prisma={user:{findUnique:async()=>({id:42,email:'mfa@example.com',name:null,passwordHash:passwordHash('test-password')})},$executeRawUnsafe:async()=>0,$queryRaw:async()=>[{localUserId:42}],subscription:{findUnique:async()=>null},authSession:{findMany:async()=>[],create:async()=>{sessions++},deleteMany:async()=>{revoked++;if(revokeFails)throw new Error('simulated session storage failure');return{count:1}}}};
 const upstream=express();upstream.use(express.json());upstream.post('/login',(req,res)=>req.body.password==='test-password'?res.json({token:'a'.repeat(43)}):res.sendStatus(401));upstream.get('/me',(_req,res)=>res.json({id:'b'.repeat(32),email:'mfa@example.com',name:null}));upstream.post('/logout',(_req,res)=>res.sendStatus(204));
 const central=upstream.listen(0,'127.0.0.1');await new Promise(resolve=>central.once('listening',resolve));process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL=`http://127.0.0.1:${central.address().port}`;
  let serial=0;const googleRequests=new Set();
 const googleHandoffs={start:async()=>{const handle=String(++serial);googleRequests.add(handle);return{handle,url:`http://127.0.0.1:${central.address().port}/account#${'r'.repeat(43)}`,expiresAt:Date.now()+300000,displayCode:'123456'};},poll:async handle=>{if(!googleRequests.has(handle))throw new Error('expired');return{status:'approved',user:{id:'b'.repeat(32)}};},take:async handle=>{if(!googleRequests.has(handle))throw new Error('expired');return{origin:process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL,centralToken:'a'.repeat(43),user:{id:'b'.repeat(32)}};},finish:handle=>googleRequests.delete(handle)};
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.header('x-test-user'))res.locals.userId=42;next()});app.use('/security',createAccountSecurityRouter(prisma,googleHandoffs));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const call=(endpoint,body,user=true,extraHeaders={})=>fetch(`http://127.0.0.1:${server.address().port}/security/mfa${endpoint}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(user?{'x-test-user':'42',authorization:'Bearer current-session'}:{}),...extraHeaders},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await call('',undefined,false)).status,401);
  assert.equal((await call('/start',{password:'wrong'})).status,401);assert.equal(accountMfa.enabled('login:user:42'),false);
    const proof=await(await call('/reauth/start',{action:'start'})).json();
  assert.equal((await call('/reauth/poll',{handle:proof.handle},true,{authorization:'Bearer other-session'})).status,403);
  assert.equal((await call('/reauth/poll',{handle:proof.handle})).status,200);
  assert.equal((await call('/disable',{googleHandle:proof.handle,code:'123456'})).status,401);
  assert.equal((await call('/start',{googleHandle:proof.handle})).status,200);
  assert.equal((await call('/start',{googleHandle:proof.handle})).status,401);
  const start=await call('/start',{password:'test-password'});assert.equal(start.status,200);const {uri,expiresAt}=await start.json();assert.ok(expiresAt>Date.now());const secret=new URL(uri).searchParams.get('secret');assert.ok(secret);assert.equal(accountMfa.enabled('login:user:42'),false);
  const invalid=await call('/confirm',{code:'bad'});assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'MFA_INVALID_CODE');
  const confirmed=await call('/confirm',{code:generateSync({secret})});assert.equal(confirmed.status,200);const {codes}=await confirmed.json();assert.equal(codes.length,10);assert.equal(revoked,1);
  await assert.rejects(createSession(prisma,42,'mfa@example.com',null,{}),AccountMfaRequired);assert.equal(sessions,0);
  await createSession(prisma,42,'mfa@example.com',null,{mfaCode:codes[0]});assert.equal(sessions,1);
  await assert.rejects(createSession(prisma,42,'mfa@example.com',null,{mfaCode:codes[0]}),AccountMfaRequired);assert.equal(sessions,1);
  assert.equal((await call('/disable',{password:'wrong',code:codes[1]})).status,401);assert.equal(accountMfa.enabled('login:user:42'),true);
  assert.equal((await call('/disable',{password:'test-password',code:codes[1]})).status,200);await createSession(prisma,42,'mfa@example.com',null,{});assert.equal(sessions,2);
  const next=await call('/start',{password:'test-password'});const nextSetup=await next.json();const nextSecret=new URL(nextSetup.uri).searchParams.get('secret');revokeFails=true;const final=await call('/confirm',{code:generateSync({secret:nextSecret})});assert.equal(final.status,200);const finalResult=await final.json();assert.equal(finalResult.enabled,true);assert.equal(finalResult.codes.length,10);assert.match(finalResult.warning,/2FA zostało włączone/);assert.equal(accountMfa.enabled('login:user:42'),true);
  const noCodeProof=await(await call('/reauth/start',{action:'disable'})).json();
  assert.equal((await call('/disable',{googleHandle:noCodeProof.handle,code:'wrong'})).status,401);
  assert.equal(accountMfa.enabled('login:user:42'),true);
  const disableProof=noCodeProof; // A stale TOTP must not consume the Google approval.
  assert.equal((await call('/reauth/poll',{handle:disableProof.handle})).status,200);
  assert.equal((await call('/disable',{googleHandle:disableProof.handle,code:finalResult.codes[0]})).status,200);
  assert.equal(accountMfa.enabled('login:user:42'),false);
 }finally{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>central.close(resolve));}
});
