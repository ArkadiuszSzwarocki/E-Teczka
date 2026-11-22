import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function fixture(){
 const values=new Map([['eteczka.mobile.vault-owner','original']]),files=new Map(),modules=new Map();
 const secure={getItemAsync:async key=>values.get(key)||null,setItemAsync:async(key,value)=>values.set(key,value),deleteItemAsync:async key=>values.delete(key)};
 const filesystem={documentDirectory:'test/',cacheDirectory:'cache/',makeDirectoryAsync:async()=>{},writeAsStringAsync:async(path,value)=>files.set(path,value),readAsStringAsync:async path=>{if(!files.has(path))throw new Error('not found');return files.get(path);},getInfoAsync:async path=>({exists:files.has(path)}),moveAsync:async({from,to})=>{files.set(to,files.get(from));files.delete(from);},deleteAsync:async path=>files.delete(path)};
 const mocks={'../types/domain':{isRetentionUnit:value=>['years','months','days'].includes(value)},'expo-secure-store':secure,'expo-file-system/legacy':filesystem,'expo-notifications':{cancelAllScheduledNotificationsAsync:async()=>{}},'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:async(_,value)=>crypto.createHash('sha256').update(value).digest('hex'),getRandomBytesAsync:async size=>crypto.randomBytes(size)},'./offlineChunks':{createOfflineChunkStore:()=>({})},'./offlineChunkCodec':{createOfflineChunkCodec:()=>({})},'./secureFileTransfer':{},'./localTls':{hasComputerCertificate:async()=>true}};
 function load(name){if(modules.has(name))return modules.get(name);const module={exports:{}};modules.set(name,module.exports);const source=fs.readFileSync(new URL(`../src/services/${name}.ts`,import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{module,exports:module.exports,require:name=>name==='crypto-js'?require(name):mocks[name]||(name.startsWith('./')?load(name.slice(2)):{}),console,Uint8Array,Set,Map,Date,setTimeout,clearTimeout,AbortController,fetch,URL});return module.exports;}
 return {load,values,files};
}
test('switching mobile accounts isolates vault keys, PINs, catalogs, queues, drafts and desktop pairing while preserving the legacy vault',async()=>{
 const {load,values,files}=fixture(),profiles=load('mobileProfile'),vault=load('offlineVault'),catalog=load('offlineCatalog'),sync=load('offlineSync'),draft=load('scanDraft'),connection=load('localConnection');
 await assert.rejects(vault.hasVault(),/zmiana konta/);
 await profiles.selectMobileProfile('original','original@example.invalid');
 await vault.createVault('123456','pin');const originalKey=values.get('eteczka.vault.key');
 values.set('eteczka.local-connection.v1',JSON.stringify({serverUrl:'https://192.168.1.2:3443',accessToken:'original-token'}));
 await catalog.saveCachedFolders([{id:1,name:'Private original'}]);await sync.queueOfflineChange({entity:'folders',operation:'created',value:{id:-1,name:'pending original'}});
 files.set('original.jpg','original image');await draft.saveScanDraft({folderId:1,pages:['original.jpg'],title:'original',retentionValue:'5',retentionUnit:'years'});
 await profiles.selectMobileProfile('second','second@example.invalid');
 assert.equal(await vault.hasVault(),false);assert.equal((await catalog.loadCachedFolders()).length,0);assert.equal(await sync.pendingChangeCount(),0);assert.equal(await draft.loadScanDraft(1),null);assert.equal(await connection.getLocalConnection(),null);
 await vault.createVault('654321','pin');assert.equal(await vault.unlockWithPin('123456'),false);assert.equal(await vault.unlockWithPin('654321'),true);
 await catalog.saveCachedFolders([{id:2,name:'Private second'}]);
 assert.equal(values.get('eteczka.vault.key'),originalKey);
 await profiles.selectMobileProfile('original');
 assert.equal(await vault.unlockWithPin('123456'),true);assert.equal((await catalog.loadCachedFolders())[0].name,'Private original');assert.equal(await sync.pendingChangeCount(),1);assert.equal((await draft.loadScanDraft(1)).title,'original');assert.equal((await connection.getLocalConnection()).accessToken,'original-token');
 await profiles.selectMobileProfile('second');assert.equal((await catalog.loadCachedFolders())[0].name,'Private second');assert.equal(await sync.pendingChangeCount(),0);
 assert.equal((await profiles.knownMobileAccounts()).length,2);
 await profiles.closeMobileProfile();await assert.rejects(vault.hasVault());
});
test('a profile switch waits for old operations and rejects path injection',async()=>{
 const {load}=fixture(),profiles=load('mobileProfile');await profiles.selectMobileProfile('original');
 let finish;const wait=new Promise(resolve=>{finish=resolve;});let after;
 const work=profiles.profileOperation(async()=>{await wait;after=profiles.profileDirectory('vault/');});const running=work();const change=profiles.selectMobileProfile('second');
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(profiles.currentMobileAccount(),'original');await assert.rejects(profiles.profileOperation(async()=>{})(),/zmiana konta/);
 finish();await running;await change;assert.equal(after,'vault/');assert.equal(profiles.currentMobileAccount(),'second');assert.equal(profiles.profileDirectory('vault/'),'vault-account-second/');
 await assert.rejects(profiles.selectMobileProfile('../original'),/identyfikator/);
});
