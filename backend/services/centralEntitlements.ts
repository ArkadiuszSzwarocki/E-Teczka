import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { centralAccountOrigin } from './centralAccountLink';
import type { Plan } from './planPolicy';

type Lease={version:1;accountId:string;deviceId:string;kind:string;plan:Plan;issuedAt:number;expiresAt:number;validUntil:number|null;deviceLimits:{desktop:number|null;mobile:number};catalog?:unknown};
type SignedLease={payload:string;signature:string;publicKey:string};
type Entry={origin:string;accountId:string;deviceId:string;credential:string;publicKey?:string;lease?:SignedLease;checkedAt?:number;blocked?:boolean};
export async function hasCentralLink(db:{ $queryRawUnsafe?: (...args:any[])=>Promise<any> },localUserId:number):Promise<boolean>{if(!db.$queryRawUnsafe)return false;const tables=await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='CentralAccountLink'");if(!tables.length)return false;const rows=await db.$queryRawUnsafe('SELECT centralId FROM CentralAccountLink WHERE localUserId = ?',localUserId);return rows.length>0;}
const filename=()=>path.join(process.cwd(),'security','central-entitlements.enc');
function read():Record<string,Entry>{try{const text=fs.readFileSync(filename(),'utf8');return JSON.parse(require('./backupCrypto').decrypt(text));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}}
function writeAtomic(file:string,encrypted:string){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2,8)}.tmp`;fs.writeFileSync(tmp,encrypted,{mode:0o600});try{fs.renameSync(tmp,file);}catch(err){try{fs.unlinkSync(tmp);}catch{}throw err;}}
function write(data:Record<string,Entry>){writeAtomic(filename(),require('./backupCrypto').encrypt(JSON.stringify(data)));}
function update(id:number,entry:Entry){const data=read();data[id]=entry;write(data);}
export function verifyEntitlement(signed:SignedLease,entry:Pick<Entry,'accountId'|'deviceId'|'publicKey'>,now=Date.now()):Lease{
 if(typeof signed?.payload!=='string'||signed.payload.length>100000||typeof signed.signature!=='string'||signed.publicKey!==entry.publicKey)throw new Error('INVALID_ENTITLEMENT');
 const key=crypto.createPublicKey({key:Buffer.from(signed.publicKey,'base64'),type:'spki',format:'der'});
 if(key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,Buffer.from(signed.payload),key,Buffer.from(signed.signature,'base64url')))throw new Error('INVALID_ENTITLEMENT');
 const lease=JSON.parse(Buffer.from(signed.payload,'base64url').toString()) as Lease;
 if(lease.version!==1||lease.accountId!==entry.accountId||lease.deviceId!==entry.deviceId||lease.kind!=='desktop'||!['free','standard','premium','family','business'].includes(lease.plan)||!Number.isSafeInteger(lease.issuedAt)||!Number.isSafeInteger(lease.expiresAt)||lease.issuedAt>now+60000||lease.expiresAt<=now||lease.expiresAt>lease.issuedAt+86400000||(lease.validUntil!==null&&lease.expiresAt>lease.validUntil))throw new Error('EXPIRED_ENTITLEMENT');
 if(lease.catalog){require('./planCatalog').applyCentralCatalog(lease.catalog);require('./planPolicy').refreshPlanPolicy();}
 return lease;
}
async function post(origin:string,endpoint:string,credential:string,body:object){const response=await fetch(`${origin}${endpoint}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${credential}`},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(7000)});const value=await response.json();return {response,value};}
export async function registerCentralDevice(localUserId:number,origin:string,accountId:string,token:string){
 const safe=centralAccountOrigin(origin);if(!safe)throw new Error('INVALID_ORIGIN');
 let entry=read()[localUserId];if(!entry||entry.blocked||entry.origin!==safe||entry.accountId!==accountId){entry={origin:safe,accountId,deviceId:crypto.randomUUID(),credential:crypto.randomBytes(32).toString('base64url')};update(localUserId,entry);}
 // The key is obtained independently through the configured HTTPS origin, not from untrusted lease data.
 const keyResponse=await fetch(`${safe}/entitlements/public-key`,{redirect:'error',signal:AbortSignal.timeout(7000)});if(!keyResponse.ok)throw new Error('CENTRAL_ENTITLEMENTS_UNAVAILABLE');const config=await keyResponse.json() as {publicKey:string};
 const {response,value}=await post(safe,'/entitlements/register',token,{deviceId:entry.deviceId,credential:entry.credential,kind:'desktop',name:'MojaTeczka Desktop'});
 if(!response.ok)throw new Error(value.code==='DEVICE_LIMIT_REACHED'?'CENTRAL_DEVICE_LIMIT':'CENTRAL_ENTITLEMENTS_UNAVAILABLE');
 entry.publicKey=config.publicKey;verifyEntitlement(value,entry);entry.lease=value;entry.checkedAt=Date.now();entry.blocked=false;failedAt.delete(localUserId);update(localUserId,entry);
}
const running=new Map<number,Promise<void>>();
export function centralDeviceRegistered(localUserId:number){return Boolean(read()[localUserId]);}
export function centralDeviceUsers(){return Object.keys(read()).map(Number);}
export function isCentralUnavailable(error:unknown){const e=error as {code?:string;name?:string};return ['CENTRAL_OFFLINE','LEDGER_UNAVAILABLE','CENTRAL_LEDGER_UNAVAILABLE'].includes(e?.code||'')||['TypeError','TimeoutError','AbortError'].includes(e?.name||'');}
const failedAt=new Map<number,number>();
const snapshotFile=()=>path.join(process.cwd(),'security','central-plan-snapshots.enc');
function snapshots():Record<string,{time:number;accountId?:string;deviceId?:string;values:Record<string,any>}>{try{return JSON.parse(require('./backupCrypto').decrypt(fs.readFileSync(snapshotFile(),'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}}
function snapshot(userId:number,key:string,value?:any){const data=snapshots();if(value!==undefined){const entry=read()[userId];if(!data[userId]||data[userId].accountId!==entry?.accountId||data[userId].deviceId!==entry?.deviceId)data[userId]={time:0,accountId:entry?.accountId,deviceId:entry?.deviceId,values:{}};data[userId].time=Math.max(data[userId].time,Date.now());data[userId].values[key]=value;writeAtomic(snapshotFile(),require('./backupCrypto').encrypt(JSON.stringify(data)));}return data[userId];}
export function centralOfflineLease(localUserId:number){const entry=read()[localUserId];if(!entry||entry.blocked)throw new Error('CENTRAL_ACCOUNT_REQUIRED');return verifyEntitlement(entry.lease!,entry);}
export async function centralPlanRequest(localUserId:number,endpoint:string,body:object={}){
 const entry=read()[localUserId];if(!entry||entry.blocked)throw new Error('CENTRAL_ACCOUNT_REQUIRED');
 const cacheKey=endpoint==='/ledger/status'?'status':endpoint==='/ledger/trial'?`trial:${(body as any).feature}`:null;
 try{
  if(Date.now()-(failedAt.get(localUserId)||0)<10000)throw Object.assign(new Error('Brak połączenia z serwerem kont.'),{code:'CENTRAL_OFFLINE'});
  const {response,value}=await post(entry.origin,endpoint,entry.credential,body);
  if(!response.ok){if(response.status===401||response.status===403&&value.code==='DEVICE_LIMIT_REACHED'){entry.blocked=true;entry.lease=undefined;update(localUserId,entry);}
   if(value.code==='PLAN_LIMIT_REACHED'){const {PlanLimitError}=require('./planLedger');throw new PlanLimitError(value.feature,Number(value.limit),value.resetsAt?new Date(value.resetsAt):undefined);}
   throw Object.assign(new Error(value.error||'Serwer planów jest niedostępny.'),{code:value.code||'CENTRAL_LEDGER_UNAVAILABLE'});
  }
  failedAt.delete(localUserId);if(cacheKey)snapshot(localUserId,cacheKey,value);return value;
 }catch(error){
  if(!isCentralUnavailable(error))throw error;if((error as any).code!=='CENTRAL_OFFLINE')failedAt.set(localUserId,Date.now());
  if(cacheKey){const lease=centralOfflineLease(localUserId);const saved=snapshot(localUserId,cacheKey),value=saved?.values[cacheKey];if(value&&saved.accountId===entry.accountId&&saved.deviceId===entry.deviceId&&Date.now()>=saved.time-60000){
   const catalog=lease.catalog as any,settings=catalog?.plans?.[lease.plan];
   if(endpoint==='/ledger/trial'){const allowed=value.endsAt===null?Boolean(settings?.[(body as any).feature]):value.allowed&&Date.now()<value.endsAt;
    if((body as any).start&&!allowed)throw new Error('Połącz się z internetem, aby rozpocząć okres próbny.');return {...value,allowed,offline:true};}
   const allowance={...value.allowance};for(const feature of ['documents','tags']){const limit=settings?.limits?.[feature];if(typeof limit==='number')allowance[feature]=allowance[feature]===null?limit:Math.min(limit,allowance[feature]);}
   return {...value,plan:lease.plan,catalog:catalog||value.catalog,allowance,offline:true};
  }}
  throw error;
 }
}
export async function revokeCentralDevice(localUserId:number,centralToken:string){const data=read(),entry=data[localUserId];if(!entry)return;const {response}=await post(entry.origin,'/devices/revoke',centralToken,{deviceId:entry.deviceId});if(!response.ok)throw new Error('DEVICE_REVOKE_FAILED');delete data[localUserId];write(data);}
export async function verifyCentralPurchase(localUserId:number,input:object){const entry=read()[localUserId];if(!entry)throw new Error('CENTRAL_ACCOUNT_REQUIRED');const {response,value}=await post(entry.origin,'/billing/google-play/verify',entry.credential,input);if(!response.ok)throw new Error(value.code||'PURCHASE_NOT_VERIFIED');await centralEntitlement(localUserId,true);return value;}
export async function centralEntitlement(localUserId:number,force=false):Promise<{plan:Plan;expiresAt:number;validUntil:number|null;blocked:boolean}|null>{
 let entry=read()[localUserId];if(!entry)return null;
 if(force||entry.blocked||Date.now()-(entry.checkedAt||0)>15000){
  let pending=running.get(localUserId);if(!pending){pending=(async()=>{try{const {response,value}=await post(entry.origin,'/entitlements/refresh',entry.credential,{});if(response.ok){verifyEntitlement(value,entry);entry.lease=value;entry.blocked=false;}else if(response.status===401||response.status===403){entry.lease=undefined;entry.blocked=true;}}catch{/* A signed lease remains usable offline until its fixed expiry. */}entry.checkedAt=Date.now();update(localUserId,entry);})();running.set(localUserId,pending);}
  try{await pending;}finally{running.delete(localUserId);}entry=read()[localUserId];
 }
 if(entry.blocked)return {plan:'free',expiresAt:0,validUntil:null,blocked:true};
 try{const lease=verifyEntitlement(entry.lease!,entry);return {plan:lease.plan,expiresAt:lease.expiresAt,validUntil:lease.validUntil,blocked:false};}catch{return {plan:'free',expiresAt:0,validUntil:null,blocked:false};}
}

