const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-login-mfa-'));process.chdir(sandbox);process.env.AUTH_SECRET='isolated-login-mfa-test-secret-not-production';
const {generateSync}=require('otplib');const {createAccountSecurityRouter}=require('../routes/accountSecurity');const {accountMfa,AccountMfaRequired}=require('../services/accountMfa');const {createSession,passwordHash}=require('../routes/auth');
test('login MFA enrolls only after password and TOTP confirmation, blocks missing codes, and consumes recovery codes once',async()=>{
 let sessions=0,revoked=0;
 const prisma={user:{findUnique:async()=>({id:42,email:'mfa@example.com',name:null,passwordHash:passwordHash('test-password')})},$executeRawUnsafe:async()=>0,$queryRaw:async()=>[{localUserId:42}],subscription:{findUnique:async()=>null},authSession:{findMany:async()=>[],create:async()=>{sessions++},deleteMany:async()=>{revoked++;return{count:1}}}};
 const upstream=express();upstream.use(express.json());upstream.post('/login',(req,res)=>req.body.password==='test-password'?res.json({token:'a'.repeat(43)}):res.sendStatus(401));upstream.get('/me',(_req,res)=>res.json({id:'b'.repeat(32),email:'mfa@example.com',name:null}));upstream.post('/logout',(_req,res)=>res.sendStatus(204));
 const central=upstream.listen(0,'127.0.0.1');await new Promise(resolve=>central.once('listening',resolve));process.env.ETECZKA_CENTRAL_ACCOUNT_URL=`http://127.0.0.1:${central.address().port}`;
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.header('x-test-user'))res.locals.userId=42;next()});app.use('/security',createAccountSecurityRouter(prisma));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const call=(endpoint,body,user=true)=>fetch(`http://127.0.0.1:${server.address().port}/security/mfa${endpoint}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(user?{'x-test-user':'42',authorization:'Bearer current-session'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await call('',undefined,false)).status,401);
  assert.equal((await call('/start',{password:'wrong'})).status,401);assert.equal(accountMfa.enabled('login:user:42'),false);
  const start=await call('/start',{password:'test-password'});assert.equal(start.status,200);const {uri}=await start.json();const secret=new URL(uri).searchParams.get('secret');assert.ok(secret);assert.equal(accountMfa.enabled('login:user:42'),false);
  assert.equal((await call('/confirm',{code:'bad'})).status,400);
  const confirmed=await call('/confirm',{code:generateSync({secret})});assert.equal(confirmed.status,200);const {codes}=await confirmed.json();assert.equal(codes.length,10);assert.equal(revoked,1);
  await assert.rejects(createSession(prisma,42,'mfa@example.com',null,{}),AccountMfaRequired);assert.equal(sessions,0);
  await createSession(prisma,42,'mfa@example.com',null,{mfaCode:codes[0]});assert.equal(sessions,1);
  await assert.rejects(createSession(prisma,42,'mfa@example.com',null,{mfaCode:codes[0]}),AccountMfaRequired);assert.equal(sessions,1);
  assert.equal((await call('/disable',{password:'wrong',code:codes[1]})).status,401);assert.equal(accountMfa.enabled('login:user:42'),true);
  assert.equal((await call('/disable',{password:'test-password',code:codes[1]})).status,200);await createSession(prisma,42,'mfa@example.com',null,{});assert.equal(sessions,2);
 }finally{await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>central.close(resolve));}
});
