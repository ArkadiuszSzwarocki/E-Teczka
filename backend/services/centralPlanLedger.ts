import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { centralDeviceRegistered, centralDeviceUsers, centralPlanRequest, centralOfflineLease, centralEntitlement, isCentralUnavailable } from './centralEntitlements';
import { devPlan } from './devPlans';
import {centralAccountOrigin} from './centralAccountLink';

type Operation={userId:number;operationId:string;transactionId:string;poolId?:string;feature?:string;amount?:number};
type Context={transactionId:string;operations:Operation[];dirty:boolean;prisma:PrismaClient;synchronized:Set<number>};
type OfflinePool={plan?:string;accountId?:string;deviceId?:string;poolId:string;feature:string;remaining:number;expiresAt:number;closed?:boolean};
type Journal={pools?:Record<string,OfflinePool[]>;clock?:number;entries:Record<string,Operation>;migrated:Record<string,boolean>};
const context=new AsyncLocalStorage<Context>(),active=new Set<string>();
const filename=()=>path.join(process.cwd(),'security','central-plan-journal.enc');
function read():Journal{try{const text=fs.readFileSync(filename(),'utf8');return JSON.parse(require('./backupCrypto').decrypt(text));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {entries:{},migrated:{}};throw error;}}
function save(data:Journal){const file=filename();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',require('./backupCrypto').encrypt(JSON.stringify(data)),{mode:0o600});fs.renameSync(file+'.tmp',file);}
const key=(op:Operation)=>`${op.userId}:${op.operationId}`;
export function centralOwner(ownerKey:string){if(devPlan(ownerKey)!==undefined)return null;const match=/^user:(\d+)$/.exec(ownerKey);const id=match?Number(match[1]):null;return id&&centralDeviceRegistered(id)?id:null;}
export function requireCentralPlanOwner(ownerKey:string){const user=centralOwner(ownerKey);if(!user&&devPlan(ownerKey)===undefined&&centralAccountOrigin(process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL))throw new Error('Zaloguj się na konto MojejTeczki, aby pobrać wspólne limity z serwera.');return user;}
export function markCentralInventoryDirty(){const ctx=context.getStore();if(ctx)ctx.dirty=true;}
export async function reserveCentralPlan(tx:Prisma.TransactionClient,userId:number,feature:string,operationId:string,amount:number){
 const ctx=context.getStore();if(!ctx)throw new Error('Operacja planu wymaga bezpiecznej transakcji.');
 if(!ctx.synchronized.has(userId)){try{const inv=await inventory(ctx.prisma,userId);await centralPlanRequest(userId,'/ledger/settle',{action:'commit',operations:[],inventory:inv});}catch(error){if(!isCentralUnavailable(error))throw error;}ctx.synchronized.add(userId);}
 const id=crypto.createHash('sha256').update(`${feature}:${operationId}`).digest('hex');
 const op:Operation={userId,operationId:id,transactionId:ctx.transactionId};
 await tx.$executeRaw`INSERT OR IGNORE INTO CentralPlanCommit(operationId) VALUES (${key(op)})`;
 if(ctx.operations.some(existing=>key(existing)===key(op)))return;
 const journal=read(),prior=journal.entries[key(op)];
 if(prior)throw new Error('Ta operacja oczekuje na rozliczenie. Połącz się z internetem i zaczekaj na synchronizację przed ponowieniem.');
 let pool:OfflinePool|undefined;
 try{const lease=centralOfflineLease(userId);if(Date.now()>=(journal.clock||0)-60000)pool=journal.pools?.[userId]?.find(p=>p.plan===lease.plan&&p.accountId===lease.accountId&&p.deviceId===lease.deviceId&&!p.closed&&p.feature===feature&&p.expiresAt>Date.now()&&p.remaining>=amount);}catch{/* An expired or revoked lease cannot spend a pool. */}
 if(pool){pool.remaining-=amount;Object.assign(op,{poolId:pool.poolId,feature,amount});}
 journal.clock=Math.max(journal.clock||0,Date.now());journal.entries[key(op)]=op;save(journal);ctx.operations.push(op);
 if(['documents','tags'].includes(feature))ctx.dirty=true;
 if(!pool){try{await centralPlanRequest(userId,'/ledger/reserve',{feature,operationId:id,amount});}catch(error){if(isCentralUnavailable(error))throw new Error('Pula offline jest wyczerpana lub wygasła. Połącz się z internetem, aby pobrać kolejny przydział.');throw error;}}

}
export function centralResourceOperation(){const ctx=context.getStore();if(!ctx)throw new Error('Brak transakcji limitu.');return `${ctx.transactionId}:${ctx.operations.length}`;}
async function inventory(prisma:PrismaClient,userId:number){
 const status=await centralPlanRequest(userId,'/ledger/status');
 const [documents,tables]=await Promise.all([prisma.document.count({where:{folder:{ownerId:userId}}}),prisma.$queryRawUnsafe<Array<{name:string}>>("SELECT name FROM sqlite_master WHERE type='table' AND name='PlanTagOwner'")]);
 const tags=tables.length?await prisma.$queryRawUnsafe<Array<{count:bigint|number}>>('SELECT COUNT(*) AS count FROM PlanTagOwner WHERE ownerId=?',userId):[{count:0}];
 return {documents,tags:Number(tags[0].count),revision:Math.max(Date.now(),Number(status.inventoryRevision||0)+1)};
}
let queue:Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{const task=queue.then(fn,fn);queue=task.catch(()=>undefined);return task;}
async function settle(prisma:PrismaClient,ops:Operation[],commit:boolean,dirty:boolean){
 const users=new Set(ops.map(op=>op.userId));if(dirty)centralDeviceUsers().forEach(id=>users.add(id));
 for(const userId of users){const own=ops.filter(op=>op.userId===userId);try{const inv=commit&&(dirty||own.length)?await inventory(prisma,userId):undefined;await centralPlanRequest(userId,'/ledger/settle',{action:commit?'commit':'cancel',operations:own.map(op=>op.operationId),pooled:own.filter(op=>op.poolId).map(op=>({operationId:op.operationId,poolId:op.poolId,feature:op.feature,amount:op.amount})),...(inv?{inventory:inv}:{})});const journal=read();for(const op of own){if(!commit&&journal.entries[key(op)]?.poolId){const pool=journal.pools?.[userId]?.find(p=>p.poolId===op.poolId);if(pool)pool.remaining+=op.amount!;}delete journal.entries[key(op)];}save(journal);}catch{/* Durable markers and journal retain every unacknowledged operation. */}}
}
export async function recoverCentralPlanJournal(prisma:PrismaClient){return serial(async()=>{const ops=Object.values(read().entries).filter(op=>!active.has(op.transactionId));for(const op of ops){const rows=await prisma.$queryRaw<Array<{operationId:string}>>`SELECT operationId FROM CentralPlanCommit WHERE operationId=${key(op)}`;await settle(prisma,[op],rows.length>0,rows.length>0);}await settle(prisma,[],true,true);});}
export async function requireSynchronizedCentralPlan(prisma:PrismaClient,ownerKey:string){const user=centralOwner(ownerKey);if(!user)return;await recoverCentralPlanJournal(prisma);if(Object.values(read().entries).some(op=>op.userId===user))throw new Error('Połącz się z internetem i zaczekaj na uzgodnienie liczników przed odtworzeniem kopii.');const state=await centralPlanRequest(user,'/ledger/status');if(state.offline)throw new Error('Odtwarzanie kopii wymaga połączenia z serwerem kont.');}
export function instrumentPlanTransactions(prisma:PrismaClient){
 const original=prisma.$transaction.bind(prisma) as any;
 const ready=prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS CentralPlanCommit (operationId TEXT PRIMARY KEY)');
 const client=prisma as any;if(client.__centralPlanTransactions)return;client.__centralPlanTransactions=true;
 const track=(tx:any,ctx:Context)=>new Proxy(tx,{get(target,property){const value=target[property];if(['document','tag','folder'].includes(String(property)))return new Proxy(value,{get(model,method){const fn=model[method];if(typeof fn!=='function')return fn;return (...args:any[])=>{if(!String(method).startsWith('find')&&!['count','aggregate','groupBy'].includes(String(method)))ctx.dirty=true;return fn.apply(model,args);};}});if(typeof value==='function')return (...args:any[])=>{if(String(property).startsWith('$executeRaw')&&String(args[0]).includes('PlanTagOwner'))ctx.dirty=true;return value.apply(target,args);};return value;}});
 client.$transaction=async(input:any,options:any)=>{if(typeof input!=='function')return original(input,options);await ready;const ctx:Context={transactionId:crypto.randomUUID(),operations:[],dirty:false,prisma,synchronized:new Set()};active.add(ctx.transactionId);try{const result=await original((tx:Prisma.TransactionClient)=>context.run(ctx,()=>input(track(tx,ctx))),{maxWait:10000,timeout:30000,...options});await serial(()=>settle(prisma,ctx.operations,true,ctx.dirty));return result;}catch(error){await serial(()=>settle(prisma,ctx.operations,false,false));throw error;}finally{active.delete(ctx.transactionId);}};
 void ready.then(()=>recoverCentralPlanJournal(prisma)).catch(error=>console.error('[plans] Nie udało się uzgodnić liczników:',error.message));
 const timer=setInterval(()=>{void (async()=>{await recoverCentralPlanJournal(prisma);for(const userId of centralDeviceUsers()){const state=centralOfflineStatus(userId);if(!state.pending&&!state.pools.some(p=>p.available>0)){await centralEntitlement(userId,true);await prepareCentralOffline(prisma,userId);}}})().catch(()=>undefined);},60000);timer.unref();
}
export async function bootstrapCentralPlan(prisma:PrismaClient,userId:number,prepareOffline=true){
 await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS CentralPlanCommit (operationId TEXT PRIMARY KEY)');
 const journal=read();if(!journal.migrated[String(userId)]){
  const tables=await prisma.$queryRawUnsafe<Array<{name:string}>>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('PlanTrial','PlanUsage')");
  const trials=tables.some(t=>t.name==='PlanTrial')?await prisma.$queryRawUnsafe<Array<{feature:string;startedAt:bigint|number}>>('SELECT feature,startedAt FROM PlanTrial WHERE ownerKey=?',`user:${userId}`):[];
  const usage=tables.some(t=>t.name==='PlanUsage')?await prisma.$queryRawUnsafe<Array<{feature:string;operationId:string;amount:number;usedAt:bigint|number}>>('SELECT feature,operationId,amount,usedAt FROM PlanUsage WHERE ownerKey=?',`user:${userId}`):[];
  const normalized=usage.map(u=>({...u,amount:Number(u.amount),usedAt:Number(u.usedAt)}));
  for(let offset=0;offset<Math.max(1,normalized.length);offset+=500){const body={trials:trials.map(t=>({...t,startedAt:Number(t.startedAt)})),usage:normalized.slice(offset,offset+500)};const batchId=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');await centralPlanRequest(userId,'/ledger/migrate',{batchId,...body});}
  const current=read();current.migrated[String(userId)]=true;save(current);
 }
 await serial(async()=>{const inv=await inventory(prisma,userId);await centralPlanRequest(userId,'/ledger/settle',{action:'commit',operations:[],inventory:inv});});
 if(prepareOffline)try{await prepareCentralOffline(prisma,userId);}catch(error){console.warn('[plans] Przydział offline będzie ponowiony po połączeniu z serwerem.');}
}
export function centralOfflineStatus(userId:number){const journal=read();let lease:ReturnType<typeof centralOfflineLease>|undefined;let valid=false;try{lease=centralOfflineLease(userId);valid=Date.now()>=(journal.clock||0)-60000;}catch{}return {pools:(journal.pools?.[userId]||[]).filter(p=>!p.closed).map(p=>({...p,available:valid&&p.plan===lease?.plan&&p.accountId===lease?.accountId&&p.deviceId===lease?.deviceId&&p.expiresAt>Date.now()?p.remaining:0})),pending:Object.values(journal.entries).filter(op=>op.userId===userId).length};}
export async function prepareCentralOffline(prisma:PrismaClient,userId:number,budgets:Record<string,number>={documents:5,tags:1,cameraScan:5,printerScan:5,merge:2}){
 await recoverCentralPlanJournal(prisma);
 return serial(async()=>{
  if(active.size||Object.values(read().entries).some(op=>op.userId===userId))throw new Error('Zaczekaj na zakończenie i synchronizację operacji przed pobraniem puli offline.');
  const status=await centralPlanRequest(userId,'/ledger/status');if(status.offline)throw new Error('Przygotowanie do pracy offline wymaga połączenia z internetem.');
  const lease=centralOfflineLease(userId);
  for(const value of Object.values(budgets))if(!Number.isSafeInteger(value)||value<0||value>100000)throw new Error('Nieprawidłowy rozmiar puli offline.');
  for(const feature of ['documents','tags','cameraScan','printerScan','merge']){
   const amount=budgets[feature]??0;if(!Number.isSafeInteger(amount)||amount<0||amount>100000)throw new Error('Nieprawidłowy rozmiar puli offline.');
   // Disable locally before releasing remotely. A lost response cannot resurrect spendable quota.
   let journal=read();journal.pools??={};const pools=journal.pools[userId]??=[];for(const pool of pools.filter(p=>p.feature===feature))pool.closed=true;save(journal);
   for(const pool of pools.filter(p=>p.feature===feature))await centralPlanRequest(userId,'/ledger/offline',{poolId:pool.poolId,close:true});
   journal=read();journal.pools![userId]=journal.pools![userId].filter(p=>p.feature!==feature);save(journal);
   if(!amount)continue;
   const poolId=crypto.randomBytes(32).toString('hex');
   // Persist an inactive claim first, so an allocation whose response is lost remains releasable.
   journal=read();journal.pools![userId].push({poolId,feature,remaining:0,expiresAt:0,closed:true});save(journal);
   const grant=await centralPlanRequest(userId,'/ledger/offline',{poolId,feature,amount});
   journal=read();journal.pools![userId]=journal.pools![userId].map(p=>p.poolId===poolId?{...grant,accountId:lease.accountId,deviceId:lease.deviceId,plan:lease.plan}:p);journal.clock=Math.max(journal.clock||0,Date.now());save(journal);
  }
  await centralPlanRequest(userId,'/ledger/status');
  for(const feature of ['ocr','cloudBackup'])await centralPlanRequest(userId,'/ledger/trial',{feature,start:false});
  return centralOfflineStatus(userId);
 });
}
