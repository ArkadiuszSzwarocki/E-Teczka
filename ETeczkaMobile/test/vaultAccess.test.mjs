import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url), ts=require('typescript');
function vault(){
 const values=new Map();let clock=Date.now();
 const secure={getItemAsync:async key=>values.get(key)||null,setItemAsync:async(key,value)=>values.set(key,value),deleteItemAsync:async key=>values.delete(key)};
 const filesystem={documentDirectory:'test/',makeDirectoryAsync:async()=>{},writeAsStringAsync:async()=>{}};
 const mocks={'./mobileProfile':{profileKey:key=>key,profileDirectory:value=>value,profileCacheDirectory:()=> 'cache/',profileOperation:fn=>fn},'expo-secure-store':secure,'expo-file-system/legacy':filesystem,'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,value)=>crypto.createHash('sha256').update(value).digest('hex'),getRandomBytesAsync:async size=>crypto.randomBytes(size)},'./offlineChunks':{createOfflineChunkStore:()=>({})},'./offlineChunkCodec':{createOfflineChunkCodec:()=>({})}};
 const source=fs.readFileSync(new URL('../src/services/offlineVault.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(compiled,{module,exports:module.exports,require:name=>name==='crypto-js'?require(name):mocks[name]||{},Date:class extends Date{static now(){return clock}},console,Uint8Array,Set});
 return {api:module.exports,values,advance:()=>{clock+=60000}};
}
test('pattern setup rejects repeated points, preserves an existing vault and verifies the chosen pattern',async()=>{
 const {api,values}=vault();
 await assert.rejects(api.createVault('0-1-0-2','pattern'),/różne punkty/);
 await assert.rejects(api.createVault('0-1-2','pattern'),/4/);
 await api.createVault('0-1-2-5','pattern');
 assert.equal(await api.vaultMode(),'pattern');assert.equal(await api.unlockWithPin('0-1-2-5'),true);
 const key=values.get('eteczka.vault.key');await assert.rejects(api.createVault('123456','pin'),/już istnieje/);assert.equal(values.get('eteczka.vault.key'),key);
});
test('failed PIN attempts trigger a persistent cooldown without deleting vault contents',async()=>{
 const {api,values,advance}=vault();await api.createVault('123456','pin');
 for(let i=0;i<5;i++)assert.equal(await api.unlockWithPin('000000'),false);
 await assert.rejects(api.unlockWithPin('123456'),/Zbyt wiele prób/);
 assert.ok(values.get('eteczka.vault.key'));advance();assert.equal(await api.unlockWithPin('123456'),true);
 assert.equal(values.has('eteczka.vault.attempts'),false);
});
