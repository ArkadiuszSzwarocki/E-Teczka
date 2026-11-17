'use strict';
const {hash,validToken,first,execute,transaction}=require('./dbHelpers');
const {getCatalog}=require('./planCatalog');
const metered=['cameraScan','printerScan','merge'],capacity=['documents','tags'];
async function ensureLedgerSchema(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS plan_offline_pools (account_id BIGINT UNSIGNED NOT NULL, device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, pool_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, feature VARCHAR(24) NOT NULL, remaining INT UNSIGNED NOT NULL, expires_at BIGINT NOT NULL, closed BOOLEAN NOT NULL DEFAULT 0, PRIMARY KEY(account_id,device_id,pool_id), INDEX(account_id,feature), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 await pool.query(`CREATE TABLE IF NOT EXISTS plan_operations (account_id BIGINT UNSIGNED NOT NULL, device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, operation_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, feature VARCHAR(24) NOT NULL, amount INT UNSIGNED NOT NULL, state VARCHAR(16) NOT NULL, used_at BIGINT NOT NULL, PRIMARY KEY(account_id,device_id,operation_id), INDEX(account_id,feature,used_at), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 await pool.query(`CREATE TABLE IF NOT EXISTS plan_trials (account_id BIGINT UNSIGNED NOT NULL, feature VARCHAR(24) NOT NULL, started_at BIGINT NOT NULL, PRIMARY KEY(account_id,feature), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 await pool.query(`CREATE TABLE IF NOT EXISTS plan_inventory (account_id BIGINT UNSIGNED NOT NULL, device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, documents INT UNSIGNED NOT NULL DEFAULT 0, tags INT UNSIGNED NOT NULL DEFAULT 0, revision BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(account_id,device_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
 await pool.query(`CREATE TABLE IF NOT EXISTS plan_migrations (account_id BIGINT UNSIGNED NOT NULL, device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, batch_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, PRIMARY KEY(account_id,device_id,batch_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
}
function createCentralLedger({pool,now=Date.now,catalogReader=getCatalog}){
 async function withDevice(raw,fn){if(!validToken(raw))throw new Error('UNAUTHORIZED');const known=await first(pool,'SELECT * FROM account_devices WHERE credential_hash = ?',[hash(raw)]);if(!known)throw new Error('DEVICE_REVOKED');return transaction(pool,async db=>{await first(db,'SELECT id FROM accounts WHERE id = ? FOR UPDATE',[known.account_id]);const current=await device(db,raw);return fn(db,current);});}
 async function device(db,credential){if(!validToken(credential))throw new Error('UNAUTHORIZED');const d=await first(db,'SELECT * FROM account_devices WHERE credential_hash = ? FOR UPDATE',[hash(credential)]);if(!d)throw new Error('DEVICE_REVOKED');await first(db,'SELECT id FROM accounts WHERE id = ? FOR UPDATE',[d.account_id]);const catalog=await catalogReader(db),p=await plan(db,d.account_id),limit=d.kind==='mobile'?catalog.plans[p].mobileDevices:catalog.plans[p].accountDevices;if(limit!==null){const devices=await execute(db,'SELECT device_id FROM account_devices WHERE account_id = ? AND kind = ? ORDER BY created_at, device_id',[d.account_id,d.kind]);if(devices.findIndex(item=>item.device_id===d.device_id)>=limit)throw new Error('DEVICE_LIMIT_REACHED');}return d;}
 async function plan(db,accountId){const p=await first(db,'SELECT * FROM account_plans WHERE account_id = ?',[accountId]);return p&&['free','standard','premium'].includes(p.plan)&&p.status==='active'&&(p.valid_until===null||Number(p.valid_until)>now())?p.plan:'free';}
 async function held(db,id,feature){const row=await first(db,'SELECT COALESCE(SUM(remaining),0) AS held FROM plan_offline_pools WHERE account_id=? AND feature=? AND closed=0',[id,feature]);return Number(row.held);}
 async function used(db,id,feature,catalog){
  const reserved=await held(db,id,feature);
  if(metered.includes(feature)){const row=await first(db,"SELECT COALESCE(SUM(amount),0) AS used, MIN(used_at) AS oldest FROM plan_operations WHERE account_id = ? AND feature = ? AND state IN ('pending','committed') AND used_at > ?",[id,feature,now()-catalog.usageDays*86400000]);return {used:Number(row.used)+reserved,oldest:row.oldest===null?null:Number(row.oldest)};}
  const row=await first(db,`SELECT COALESCE(SUM(i.${feature}),0) AS used FROM plan_inventory i JOIN account_devices d ON d.account_id=i.account_id AND d.device_id=i.device_id WHERE i.account_id = ?`,[id]);
  const pending=await first(db,"SELECT COALESCE(SUM(o.amount),0) AS used FROM plan_operations o JOIN account_devices d ON d.account_id=o.account_id AND d.device_id=o.device_id WHERE o.account_id = ? AND o.feature = ? AND o.state IN ('pending','committed')",[id,feature]);return {used:Number(row.used)+Number(pending.used)+reserved,oldest:null};
 }
 async function reserve(raw,input){return withDevice(raw,async(db,d)=>{const {operationId,feature,amount}=input||{};if(typeof operationId!=='string'||!/^[a-f0-9]{64}$/.test(operationId)||![...metered,...capacity].includes(feature)||!Number.isSafeInteger(amount)||amount<1||amount>100000000)throw new Error('INVALID_OPERATION');
  const existing=await first(db,'SELECT * FROM plan_operations WHERE account_id = ? AND device_id = ? AND operation_id = ?',[d.account_id,d.device_id,operationId]);if(existing){if(existing.amount!==amount&&Number(existing.amount)!==amount||existing.feature!==feature)throw new Error('OPERATION_MISMATCH');if(existing.state!=='cancelled')return {state:existing.state};}
  const catalog=await catalogReader(db),p=await plan(db,d.account_id),limit=catalog.plans[p].limits[feature];const total=await used(db,d.account_id,feature,catalog);if(limit!==null&&total.used+amount>limit){const error=new Error('PLAN_LIMIT_REACHED');error.limit=limit;error.feature=feature;error.resetsAt=total.oldest===null?null:total.oldest+catalog.usageDays*86400000;throw error;}
  await execute(db,"INSERT INTO plan_operations (account_id,device_id,operation_id,feature,amount,state,used_at) VALUES (?,?,?,?,?,'pending',?) ON DUPLICATE KEY UPDATE state='pending',used_at=VALUES(used_at)",[d.account_id,d.device_id,operationId,feature,amount,now()]);return {state:'pending'};
 });}
 async function offline(raw,input){return withDevice(raw,async(db,d)=>{
  const {poolId,feature,amount,close}=input||{};
  if(typeof poolId!=='string'||!/^[a-f0-9]{64}$/.test(poolId))throw new Error('INVALID_OPERATION');
  const prior=await first(db,'SELECT * FROM plan_offline_pools WHERE account_id=? AND device_id=? AND pool_id=?',[d.account_id,d.device_id,poolId]);
  if(close===true){if(prior)await execute(db,'UPDATE plan_offline_pools SET closed=1,remaining=0 WHERE account_id=? AND device_id=? AND pool_id=?',[d.account_id,d.device_id,poolId]);return {closed:true};}
  if(prior)return {poolId,feature:prior.feature,remaining:Number(prior.remaining),expiresAt:Number(prior.expires_at),closed:Boolean(prior.closed)};
  if(![...metered,...capacity].includes(feature)||!Number.isSafeInteger(amount)||amount<1||amount>100000)throw new Error('INVALID_OPERATION');
  const catalog=await catalogReader(db),p=await plan(db,d.account_id),total=await used(db,d.account_id,feature,catalog),limit=catalog.plans[p].limits[feature];
  const grant=limit===null?amount:Math.min(amount,Math.max(0,limit-total.used));
  if(!grant) return {poolId,feature,remaining:0,expiresAt:now(),closed:true};
  const assignment=await first(db,'SELECT valid_until FROM account_plans WHERE account_id=?',[d.account_id]);
  const expiresAt=Math.min(now()+Math.min(1,catalog.usageDays)*86400000,p!=='free'&&assignment?.valid_until!==null?Number(assignment.valid_until):Infinity);
  await execute(db,'INSERT INTO plan_offline_pools (account_id,device_id,pool_id,feature,remaining,expires_at) VALUES (?,?,?,?,?,?)',[d.account_id,d.device_id,poolId,feature,grant,expiresAt]);
  return {poolId,feature,remaining:grant,expiresAt,closed:false};
 });}
 async function settle(raw,input){return withDevice(raw,async(db,d)=>{if(!Array.isArray(input?.operations)||input.operations.length>10000||!input.operations.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id))||!['commit','cancel'].includes(input.action))throw new Error('INVALID_OPERATION');
  if(input.inventory){const inv=input.inventory;if(!['documents','tags','revision'].every(k=>Number.isSafeInteger(inv[k])&&inv[k]>=0)||inv.documents>100000000||inv.tags>100000000)throw new Error('INVALID_INVENTORY');const prior=await first(db,'SELECT revision FROM plan_inventory WHERE account_id = ? AND device_id = ?',[d.account_id,d.device_id]);if(!prior||Number(prior.revision)<inv.revision)await execute(db,'INSERT INTO plan_inventory (account_id,device_id,documents,tags,revision) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE documents=VALUES(documents),tags=VALUES(tags),revision=VALUES(revision)',[d.account_id,d.device_id,inv.documents,inv.tags,inv.revision]);}
  if(input.pooled!==undefined){if(!Array.isArray(input.pooled)||input.pooled.length>10000)throw new Error('INVALID_OPERATION');for(const op of input.pooled){
   if(!input.operations.includes(op.operationId)||typeof op.poolId!=='string'||!/^[a-f0-9]{64}$/.test(op.poolId)||!Number.isSafeInteger(op.amount)||op.amount<1)throw new Error('INVALID_OPERATION');
   const existing=await first(db,'SELECT * FROM plan_operations WHERE account_id=? AND device_id=? AND operation_id=?',[d.account_id,d.device_id,op.operationId]);
   const bucket=await first(db,'SELECT * FROM plan_offline_pools WHERE account_id=? AND device_id=? AND pool_id=?',[d.account_id,d.device_id,op.poolId]);
   if(!bucket||bucket.feature!==op.feature)throw new Error('INVALID_OPERATION');
   if(existing){if(existing.feature!==op.feature||Number(existing.amount)!==op.amount)throw new Error('OPERATION_MISMATCH');continue;}
   if(input.action==='cancel')continue;
   if(bucket.closed||Number(bucket.remaining)<op.amount)throw new Error('OFFLINE_POOL_EXHAUSTED');
   if(capacity.includes(op.feature)&&!input.inventory)throw new Error('INVALID_INVENTORY');
   await execute(db,'UPDATE plan_offline_pools SET remaining=remaining-? WHERE account_id=? AND device_id=? AND pool_id=?',[op.amount,d.account_id,d.device_id,op.poolId]);
   await execute(db,"INSERT INTO plan_operations (account_id,device_id,operation_id,feature,amount,state,used_at) VALUES (?,?,?,?,?,'pending',?)",[d.account_id,d.device_id,op.operationId,op.feature,op.amount,now()]);
  }}
  for(const id of input.operations){const row=await first(db,'SELECT * FROM plan_operations WHERE account_id = ? AND device_id = ? AND operation_id = ?',[d.account_id,d.device_id,id]);if(!row)continue;if(input.action==='cancel'){if(row.state==='pending')await execute(db,"UPDATE plan_operations SET state='cancelled' WHERE account_id=? AND device_id=? AND operation_id=?",[d.account_id,d.device_id,id]);}else{const state=capacity.includes(row.feature)&&input.inventory?'settled':'committed';if(row.state!=='cancelled')await execute(db,'UPDATE plan_operations SET state=? WHERE account_id=? AND device_id=? AND operation_id=?',[state,d.account_id,d.device_id,id]);}}
  return {ok:true};
 });}
 function ends(feature,started,catalog,planName){if(feature==='ocr'){const days=planName==='standard'?(catalog.standardOcrTrialDays??60):catalog.ocrTrialDays;return started+days*86400000;}const end=new Date(started),day=end.getUTCDate();end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+catalog.backupTrialMonths);const last=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();end.setUTCDate(Math.min(day,last));return end.getTime();}
 async function trial(raw,input){return withDevice(raw,async(db,d)=>{const feature=input?.feature;if(!['ocr','cloudBackup'].includes(feature))throw new Error('INVALID_FEATURE');const catalog=await catalogReader(db),p=await plan(db,d.account_id);if(catalog.plans[p][feature])return {allowed:true,startedAt:null,endsAt:null};if(input.start===true)await execute(db,'INSERT IGNORE INTO plan_trials (account_id,feature,started_at) VALUES (?,?,?)',[d.account_id,feature,now()]);const row=await first(db,'SELECT started_at FROM plan_trials WHERE account_id=? AND feature=?',[d.account_id,feature]);const started=row?Number(row.started_at):null;const end=started===null?null:ends(feature,started,catalog,p);return {allowed:started!==null&&now()<end,startedAt:started,endsAt:end};});}
 async function status(raw){return withDevice(raw,async(db,d)=>{
  const catalog=await catalogReader(db),p=await plan(db,d.account_id);
  const own=await first(db,'SELECT revision FROM plan_inventory WHERE account_id = ? AND device_id = ?',[d.account_id,d.device_id]);
  const result={plan:p,catalog,inventoryRevision:own?Number(own.revision):0,allowance:{}};
  const inventories=await execute(db,'SELECT i.device_id,i.documents,i.tags FROM plan_inventory i JOIN account_devices d ON d.account_id=i.account_id AND d.device_id=i.device_id WHERE i.account_id=? ORDER BY d.created_at,d.device_id',[d.account_id]);
  for(const feature of [...capacity,...metered]){
   const total=await used(db,d.account_id,feature,catalog),limit=catalog.plans[p].limits[feature];
   result[feature]={used:total.used,reservedOffline:await held(db,d.account_id,feature),limit,remaining:limit===null?null:Math.max(0,limit-total.used),nextRenewal:total.oldest===null?null:total.oldest+catalog.usageDays*86400000};
   if(capacity.includes(feature)){let preceding=0;for(const row of inventories){if(row.device_id===d.device_id)break;preceding+=Number(row[feature]);}result.allowance[feature]=limit===null?null:Math.max(0,limit-preceding);}
  }
  return result;
 });}
 async function migrate(raw,input){return withDevice(raw,async(db,d)=>{if(typeof input?.batchId!=='string'||!/^[a-f0-9]{64}$/.test(input.batchId)||!Array.isArray(input.trials)||input.trials.length>2||!Array.isArray(input.usage)||input.usage.length>1000)throw new Error('INVALID_MIGRATION');const prior=await first(db,'SELECT batch_id FROM plan_migrations WHERE account_id=? AND device_id=? AND batch_id=?',[d.account_id,d.device_id,input.batchId]);if(prior)return {ok:true};
  for(const t of input.trials){if(!['ocr','cloudBackup'].includes(t.feature)||!Number.isSafeInteger(t.startedAt)||t.startedAt<0||t.startedAt>now())throw new Error('INVALID_MIGRATION');await execute(db,'INSERT INTO plan_trials (account_id,feature,started_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE started_at=LEAST(started_at,VALUES(started_at))',[d.account_id,t.feature,t.startedAt]);}
  for(const u of input.usage){if(!metered.includes(u.feature)||typeof u.operationId!=='string'||!u.operationId||u.operationId.length>128||!Number.isSafeInteger(u.amount)||u.amount<1||u.amount>100000000||!Number.isSafeInteger(u.usedAt)||u.usedAt<0||u.usedAt>now()+60000)throw new Error('INVALID_MIGRATION');await execute(db,"INSERT IGNORE INTO plan_operations (account_id,device_id,operation_id,feature,amount,state,used_at) VALUES (?,?,?,?,?,'committed',?)",[d.account_id,d.device_id,hash(`${u.feature}:${u.operationId}`),u.feature,u.amount,Math.min(u.usedAt,now())]);}
  await execute(db,'INSERT INTO plan_migrations (account_id,device_id,batch_id) VALUES (?,?,?)',[d.account_id,d.device_id,input.batchId]);return {ok:true};});}
 return {reserve,settle,trial,status,migrate,offline};
}
module.exports={ensureLedgerSchema,createCentralLedger};
