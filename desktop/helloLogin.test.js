const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHelloLogin}=require('./helloLogin');

test('Hello cancellation creates no login request; successful consent supports MFA continuation without exposing the key',async()=>{
  const filename=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hello-client-')),'credential.bin');let consent=true,prompts=0,logins=0,challengeCalls=0;
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).toString('base64'),decryptString:buffer=>Buffer.from(buffer.toString(),'base64').toString()};
  const request=async(url,options)=>{const body=JSON.parse(options.body);let data={};if(url.endsWith('/enroll'))data={keyId:'key-id',email:'hello@example.com'};if(url.endsWith('/challenge')){challengeCalls++;data={challenge:'a'.repeat(43)};}if(url.endsWith('/login')){logins++;data=body.mfaCode==='recovery'?{token:'session-token',user:{email:'hello@example.com'}}:{code:'MFA_REQUIRED'};}return{ok:!data.code,status:200,json:async()=>data};};
  const hello=createHelloLogin({filename,safeStorage,verifyHello:async()=>{prompts++;return {ok:consent};},request});
  assert.equal((await hello.enroll('session','device-id')).ok,true);assert.deepEqual(hello.list(),[{email:'hello@example.com'}]);
  assert.equal(fs.readFileSync(filename,'utf8').includes('PRIVATE KEY'),false);
  consent=false;assert.equal((await hello.login(1,'hello@example.com','')).ok,false);assert.equal(logins,0);assert.equal(challengeCalls,0);
  consent=true;const first=await hello.login(1,'hello@example.com','');assert.equal(first.code,'MFA_REQUIRED');assert.equal(first.privateKey,undefined);const before=prompts;
  const second=await hello.login(1,'hello@example.com','recovery');assert.equal(second.ok,true);assert.equal(prompts,before);assert.equal(challengeCalls,1);
  await hello.login(1,'hello@example.com','recovery');assert.equal(prompts,before+1);assert.equal(challengeCalls,2);
  await hello.revoke('session','hello@example.com');assert.deepEqual(hello.list(),[]);
});
