const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-hello-auth-')));process.env.AUTH_SECRET='isolated-hello-test-secret-not-production';
const {createSession}=require('../routes/auth');
const {createHelloAuthRouter}=require('../routes/helloAuth');
const {accountMfa}=require('../services/accountMfa');const {generateSync}=require('otplib');

test('trusted Hello login verifies signatures, replaces repeated MFA only for trusted proofs, expires sessions, rejects replays and supports revocation',async()=>{
  const user={id:71,email:'hello@example.com',name:'Hello'};let sessions=[];
  const authHash=crypto.createHash('sha256').update('valid-session').digest('hex');
  const prisma={authSession:{findFirst:async({where})=>where.tokenHash===authHash?{user}:null,findMany:async()=>[],create:async({data})=>sessions.push(data)},user:{findUnique:async()=>user},subscription:{findUnique:async()=>null}};
  const app=express();app.use(express.json());app.use(createHelloAuthRouter(prisma));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const call=(route,data,token)=>fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});
  const keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
  const signed=challenge=>({challenge,signature:crypto.sign(null,Buffer.from(`E-Teczka Hello login:${challenge}`),keys.privateKey).toString('base64url')});
  try{
    assert.equal((await call('/enroll',{publicKey})).status,401);
    const enrolled=await call('/enroll',{publicKey,deviceId:'trusted-test-device'},'valid-session');assert.equal(enrolled.status,200);const {keyId}=await enrolled.json();
    const challenge=(await(await call('/challenge',{keyId})).json()).challenge;
    const invalid=await call('/login',{challenge,signature:'forged'});assert.equal(invalid.status,401);assert.equal(sessions.length,0);
    const next=(await(await call('/challenge',{keyId})).json()).challenge;
    const logged=await call('/login',signed(next));assert.equal(logged.status,200);assert.ok((await logged.json()).token);
    assert.equal(sessions.length,1);assert.equal(sessions[0].deviceId,'trusted-test-device');assert.ok(Math.abs(sessions[0].expiresAt.getTime()-Date.now()-20*60000)<2000);
    assert.equal((await call('/login',signed(next))).status,401);assert.equal(sessions.length,1);
    const setup=accountMfa.start('login:user:71');const secret=new URL(setup.uri).searchParams.get('secret');const recovery=accountMfa.confirm('login:user:71',generateSync({secret}));
    const mfaChallenge=(await(await call('/challenge',{keyId})).json()).challenge;const proof=signed(mfaChallenge);
    await assert.rejects(createSession(prisma,user.id,user.email,user.name,{trustedHello:true,authentication:'trusted-hello'}),error=>error.code==='MFA_REQUIRED');
    const trusted=await call('/login',proof);assert.equal(trusted.status,200);assert.equal(sessions.length,2);
    assert.equal((await call('/login',proof)).status,401,'a trusted proof still cannot be replayed');
    const reused=(await(await call('/challenge',{keyId})).json()).challenge;
    assert.equal((await call('/revoke',{keyId},'valid-session')).status,204);assert.equal((await call('/challenge',{keyId})).status,401);
    assert.equal((await call('/login',{...signed(reused),mfaCode:recovery[1]})).status,401);assert.equal(sessions.length,2);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
