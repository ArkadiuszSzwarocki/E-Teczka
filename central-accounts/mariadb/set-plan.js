'use strict';
const {createDatabasePool}=require('./database');
const {ensureEntitlementsSchema,plans}=require('./entitlements');
async function setPlan(pool,email,plan,until){
  if(typeof email!=='string'||!plans[plan])throw new Error('Podaj e-mail i plan: free, standard lub premium.');
  const expires=until?Date.parse(until):null;
  if(plan!=='free'&&(!Number.isFinite(expires)||expires<=Date.now()))throw new Error('Plan płatny wymaga przyszłej daty końca w formacie ISO.');
  await ensureEntitlementsSchema(pool);
  const [accounts]=await pool.execute('SELECT id FROM accounts WHERE email = ? AND verified = 1',[email.trim().toLowerCase()]);if(!accounts.length)throw new Error('Nie znaleziono potwierdzonego konta.');
  await pool.execute("INSERT INTO account_plans (account_id,plan,status,valid_until,source,updated_at) VALUES (?,?,'active',?,'admin',?) ON DUPLICATE KEY UPDATE plan=VALUES(plan),status='active',valid_until=VALUES(valid_until),source='admin',updated_at=VALUES(updated_at)",[accounts[0].id,plan,plan==='free'?null:expires,Date.now()]);
}
if(require.main===module){const pool=createDatabasePool();setPlan(pool,...process.argv.slice(2)).then(()=>console.log('Zapisano centralny plan konta.')).catch(error=>{console.error(error.code||error.message);process.exitCode=1;}).finally(()=>pool.end());}
module.exports={setPlan};
