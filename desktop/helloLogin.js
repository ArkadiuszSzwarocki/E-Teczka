'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

function createHelloLogin({ filename, safeStorage, verifyHello, request = fetch }) {
  const pending = new Map();
  const busy = new Set();
  function read() {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Szyfrowanie systemowe jest niedostępne.');
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(filename))); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  function save(data) { const temp=filename+'.tmp';fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(data)),{mode:0o600});fs.renameSync(temp,filename); }
  async function post(path, body, token) {
    const response=await request('http://127.0.0.1:3000/api/hello'+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
    const data=response.status===204?{}:await response.json().catch(()=>({}));
    return {ok:response.ok,...data};
  }
  function list() { try{return Object.values(read()).map(({email})=>({email}));}catch{return [];} }
  async function enroll(token, deviceId) {
    const verified=await verifyHello('Włącz logowanie do E-Teczki przez Windows Hello');if(!verified.ok)return verified;
    const keys=crypto.generateKeyPairSync('ed25519');
    const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
    const result=await post('/enroll',{publicKey,deviceId},token);if(!result.ok)return result;
    try{const data=read();data[result.email]={email:result.email,keyId:result.keyId,privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()};save(data);return {ok:true};}
    catch{await post('/revoke',{keyId:result.keyId},token).catch(()=>undefined);return {ok:false,error:'Nie udało się zaszyfrować danych Windows Hello.'};}
  }
  async function revoke(token, email) {
    const data=read();if(!data[email])return {ok:true};const result=await post('/revoke',{keyId:data[email].keyId},token);if(!result.ok)return result;
    delete data[email];save(data);pending.clear();return {ok:true};
  }
  async function login(sender, email, mfaCode) {
    if(busy.has(sender))return {ok:false,error:'Weryfikacja już trwa.'};busy.add(sender);
    try{
      const record=read()[email];if(!record)return {ok:false,error:'Najpierw włącz Windows Hello w ustawieniach tego konta.'};
      let proof=pending.get(sender);
      if(!proof||proof.email!==email||proof.expires<=Date.now()){
        pending.delete(sender);const verified=await verifyHello(`Zaloguj do E-Teczki: ${email}`);if(!verified.ok)return verified;
        const result=await post('/challenge',{keyId:record.keyId});if(!result.ok)return result;
        const signature=crypto.sign(null,Buffer.from(`E-Teczka Hello login:${result.challenge}`),record.privateKey).toString('base64url');
        proof={email,challenge:result.challenge,signature,expires:Date.now()+90000};pending.set(sender,proof);
      }
      const result=await post('/login',{challenge:proof.challenge,signature:proof.signature,mfaCode});
      if(result.code!=='MFA_REQUIRED')pending.delete(sender);
      return result;
    }catch{return {ok:false,error:'Nie udało się zalogować przez Windows Hello. Możesz użyć Google lub hasła.'};}finally{busy.delete(sender);}
  }
  return { list, enroll, revoke, login };
}
module.exports={createHelloLogin};
