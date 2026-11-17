'use strict';
const crypto = require('node:crypto');
const { hash, validToken, first, execute, transaction } = require('./dbHelpers');
const plans = { free:{desktop:1,mobile:1}, standard:{desktop:2,mobile:1}, premium:{desktop:null,mobile:1} };
async function ensureEntitlementsSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS account_plans (account_id BIGINT UNSIGNED PRIMARY KEY, plan VARCHAR(16) NOT NULL DEFAULT 'free', status VARCHAR(16) NOT NULL DEFAULT 'active', valid_until BIGINT NULL, source VARCHAR(32) NOT NULL DEFAULT 'admin', updated_at BIGINT NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS account_devices (account_id BIGINT UNSIGNED NOT NULL, device_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, kind VARCHAR(16) NOT NULL, name VARCHAR(80) NOT NULL, credential_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE, created_at BIGINT NOT NULL, last_seen BIGINT NOT NULL, PRIMARY KEY(account_id,device_id), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE) ENGINE=InnoDB`);
  await pool.execute("INSERT IGNORE INTO account_plans (account_id,plan,status,updated_at) SELECT id,'free','active',? FROM accounts",[Date.now()]);
}
function createEntitlements({pool,getSession,privateKey,catalogReader,now=Date.now}) {
  const key=crypto.createPrivateKey({key:Buffer.from(privateKey,'base64'),type:'pkcs8',format:'der'});
  if(key.asymmetricKeyType!=='ed25519')throw new Error('INVALID_ENTITLEMENT_SIGNING_KEY');
  const publicKey=crypto.createPublicKey(key).export({type:'spki',format:'der'}).toString('base64');
  async function account(raw){const user=await getSession(raw);if(!user)throw new Error('UNAUTHORIZED');return user;}
  async function effective(db,id){await execute(db,"INSERT IGNORE INTO account_plans (account_id,plan,status,updated_at) VALUES (?,'free','active',?)",[id,now()]);const row=await first(db,'SELECT * FROM account_plans WHERE account_id = ?',[id]);const active=row&&row.status==='active'&&plans[row.plan]&&(row.valid_until===null||Number(row.valid_until)>now());const plan=active?row.plan:'free';const catalog=catalogReader?await catalogReader(db):null;return {plan,validUntil:active&&row.valid_until!==null?Number(row.valid_until):null,catalog,limits:catalog?{desktop:catalog.plans[plan].accountDevices,mobile:catalog.plans[plan].mobileDevices}:plans[plan]};}
  function issue(user,device,state){const expiresAt=Math.min(now()+86400000,state.validUntil??Infinity);const payload=Buffer.from(JSON.stringify({version:1,accountId:user.id,deviceId:device.device_id,kind:device.kind,plan:state.plan,validUntil:state.validUntil,deviceLimits:state.limits,...(state.catalog?{catalog:state.catalog}:{}),issuedAt:now(),expiresAt})).toString('base64url');return {payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64url'),publicKey};}
  return {
    publicKey,
    async register(raw,input){const user=await account(raw);const {deviceId,credential,kind}=input||{};if(typeof deviceId!=='string'||!/^[a-zA-Z0-9:_-]{8,128}$/.test(deviceId)||!validToken(credential)||!['desktop','mobile'].includes(kind))throw new Error('INVALID_DEVICE');
      return transaction(pool,async db=>{await first(db,'SELECT id FROM accounts WHERE id = ? FOR UPDATE',[user.internal_id]);const state=await effective(db,user.internal_id);const device=await first(db,'SELECT * FROM account_devices WHERE account_id = ? AND device_id = ?',[user.internal_id,deviceId]);
        if(device&&(device.credential_hash!==hash(credential)||device.kind!==kind))throw new Error('DEVICE_CREDENTIAL_REQUIRED');
        if(device&&state.limits[kind]!==null){const devices=await execute(db,'SELECT device_id FROM account_devices WHERE account_id = ? AND kind = ? ORDER BY created_at, device_id',[user.internal_id,kind]);if(devices.findIndex(item=>item.device_id===deviceId)>=state.limits[kind])throw new Error('DEVICE_LIMIT_REACHED');}
        if(!device){const rows=await execute(db,'SELECT device_id FROM account_devices WHERE account_id = ? AND kind = ?',[user.internal_id,kind]);const limit=state.limits[kind];if(limit!==null&&rows.length>=limit)throw new Error('DEVICE_LIMIT_REACHED');await execute(db,'INSERT INTO account_devices (account_id,device_id,kind,name,credential_hash,created_at,last_seen) VALUES (?,?,?,?,?,?,?)',[user.internal_id,deviceId,kind,String(input.name||'E-Teczka').slice(0,80),hash(credential),now(),now()]);}
        await execute(db,'UPDATE account_devices SET last_seen = ? WHERE account_id = ? AND device_id = ?',[now(),user.internal_id,deviceId]);return issue(user,{device_id:deviceId,kind},state);
      });
    },
    async refresh(credential){if(!validToken(credential))throw new Error('UNAUTHORIZED');const device=await first(pool,'SELECT d.*, a.public_id FROM account_devices d JOIN accounts a ON a.id = d.account_id WHERE d.credential_hash = ?',[hash(credential)]);if(!device)throw new Error('DEVICE_REVOKED');const state=await effective(pool,device.account_id);const limit=state.limits[device.kind];if(limit!==null){const devices=await execute(pool,'SELECT device_id FROM account_devices WHERE account_id = ? AND kind = ? ORDER BY created_at, device_id',[device.account_id,device.kind]);if(devices.findIndex(item=>item.device_id===device.device_id)>=limit)throw new Error('DEVICE_LIMIT_REACHED');}await execute(pool,'UPDATE account_devices SET last_seen = ? WHERE account_id = ? AND device_id = ?',[now(),device.account_id,device.device_id]);return issue({id:device.public_id},device,state);},
    async list(raw){const user=await account(raw);const state=await effective(pool,user.internal_id);const devices=await execute(pool,'SELECT device_id,kind,name,created_at,last_seen FROM account_devices WHERE account_id = ?',[user.internal_id]);return {...state,deviceLimits:state.limits,devices};},
    async revoke(raw,deviceId){const user=await account(raw);await execute(pool,'DELETE FROM account_devices WHERE account_id = ? AND device_id = ?',[user.internal_id,String(deviceId||'')]);}
  };
}
module.exports={ensureEntitlementsSchema,createEntitlements,plans};
