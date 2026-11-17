'use strict';
const defaults=require('../catalog.defaults.json');
const {first,execute}=require('./dbHelpers');
const ids=['free','standard','premium','family','business'];
function validateCatalog(value){
 const d=value&&value.plans?{...value,plans:{...value.plans,family:value.plans.family||structuredClone(defaults.plans.family),business:value.plans.business||structuredClone(defaults.plans.business)}}:value;const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 if(!d||d.version!==1||!integer(d.usageDays,1,365)||!integer(d.ocrTrialDays,0,3650)||(d.standardOcrTrialDays!==undefined&&!integer(d.standardOcrTrialDays,0,3650))||!integer(d.backupTrialMonths,0,120)||!d.plans||!Array.isArray(d.promotions)||d.promotions.length>100)throw new Error('INVALID_CATALOG');
 for(const id of ids){const p=d.plans[id];if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||!['ocr','cloudBackup','premiumTools'].every(k=>typeof p[k]==='boolean')||!integer(p.monthly,0,100000000)||!integer(p.yearly,0,100000000)||!integer(p.mobileDevices,1,10000)||!(p.accountDevices===null||integer(p.accountDevices,1,10000))||!p.limits)throw new Error('INVALID_CATALOG');for(const k of ['documents','tags','cameraScan','printerScan','merge'])if(!(p.limits[k]===null||integer(p.limits[k],0,100000000)))throw new Error('INVALID_CATALOG');}
 if(d.plans.free.monthly||d.plans.free.yearly)throw new Error('INVALID_CATALOG');const seen=new Set();
 for(const p of d.promotions){if(!p||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)||seen.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||!['standard','premium','family','business'].includes(p.plan)||!['monthly','yearly'].includes(p.interval)||!integer(p.percent,1,100)||typeof p.enabled!=='boolean'||!Number.isFinite(Date.parse(p.startsAt))||!Number.isFinite(Date.parse(p.endsAt))||Date.parse(p.startsAt)>=Date.parse(p.endsAt))throw new Error('INVALID_CATALOG');seen.add(p.id);}
 return JSON.parse(JSON.stringify(d));
}
async function ensureCatalogSchema(pool){await pool.query('CREATE TABLE IF NOT EXISTS plan_catalog (id TINYINT UNSIGNED PRIMARY KEY, payload LONGTEXT NOT NULL, updated_at BIGINT NOT NULL) ENGINE=InnoDB');await pool.execute('INSERT IGNORE INTO plan_catalog (id,payload,updated_at) VALUES (1,?,?)',[JSON.stringify(defaults),Date.now()]);}
async function getCatalog(db){const row=await first(db,'SELECT payload,updated_at FROM plan_catalog WHERE id = 1');return row?{...validateCatalog(JSON.parse(row.payload)),revision:Number(row.updated_at)}:structuredClone(defaults);}
async function saveCatalog(db,value){const data=validateCatalog(value);await execute(db,'UPDATE plan_catalog SET payload = ?, updated_at = ? WHERE id = 1',[JSON.stringify(data),Date.now()]);return getCatalog(db);}
module.exports={getCatalog,saveCatalog,validateCatalog,ensureCatalogSchema};
