const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eteczka-idle-session-'));process.chdir(dir);
const {activeSessionWhere,effectiveSessionExpiry,SESSION_DURATION_MS,ensureIdleSessionPolicy}=require('../services/sessionPolicy');
const {createSession,createAuthRouter}=require('../routes/auth');

test('new sessions start with twenty minutes; validity follows the extended expiry rather than creation time',async()=>{
 let saved;const prisma={subscription:{findUnique:async()=>null},authSession:{findMany:async()=>[],create:async({data})=>{saved=data;}}};const before=Date.now();const session=await createSession(prisma,42,'session@example.com',null,{deviceId:'test-desktop'});
 assert.ok(session.expiresAt.getTime()>=before+SESSION_DURATION_MS);assert.ok(session.expiresAt.getTime()<=Date.now()+SESSION_DURATION_MS);assert.equal(saved.expiresAt,session.expiresAt);
 const extended=new Date('2026-11-16T12:20:00Z');assert.equal(effectiveSessionExpiry(new Date('2026-11-15T12:00:00Z'),extended),extended);assert.equal(activeSessionWhere().createdAt,undefined);
});

test('only explicit activity renews a live session; polling, expired tokens and logged-out tokens cannot renew it',async()=>{
 const token='test-session',hash=crypto.createHash('sha256').update(token).digest('hex');let row={tokenHash:hash,createdAt:new Date('2000-01-01'),expiresAt:new Date(Date.now()+60000),user:{id:42,email:'session@example.com',name:null}};
 const prisma={authSession:{findFirst:async({where})=>row&&row.tokenHash===where.tokenHash&&row.expiresAt>where.expiresAt.gt?row:null,updateMany:async({where,data})=>{if(!row||row.tokenHash!==where.tokenHash||row.expiresAt<=where.expiresAt.gt)return{count:0};row={...row,...data};return{count:1};},deleteMany:async()=>{row=null;return{count:1};}}};
 const app=express();app.use('/auth',createAuthRouter(prisma));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const request=(route,method='GET',credential=token)=>fetch(`http://127.0.0.1:${server.address().port}/auth/${route}`,{method,headers:{authorization:`Bearer ${credential}`}});
 try{const original=row.expiresAt.getTime();assert.equal((await request('me')).status,200);assert.equal((await request('me')).status,200);assert.equal(row.expiresAt.getTime(),original,'automatic polling does not count as interaction');
  const before=Date.now();const renewed=await request('activity','POST');assert.equal(renewed.status,200);assert.ok(row.expiresAt.getTime()>=before+SESSION_DURATION_MS);assert.ok(row.expiresAt.getTime()<=Date.now()+SESSION_DURATION_MS);assert.equal(row.createdAt.getFullYear(),2000,'creation history is preserved');assert.equal((await renewed.json()).idleTimeoutMs,1200000);
  assert.equal((await request('activity','POST','wrong-token')).status,401);row.expiresAt=new Date(Date.now()-1);assert.equal((await request('activity','POST')).status,401);assert.equal((await request('me')).status,401);
  row.expiresAt=new Date(Date.now()+SESSION_DURATION_MS);assert.equal((await request('logout','POST')).status,200);assert.equal((await request('activity','POST')).status,401);assert.equal(row,null);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('migration expires historical long sessions once and preserves sliding sessions across restarts',async()=>{
 const {PrismaClient}=require('@prisma/client');const url=`file:${path.join(dir,'migration.db').replace(/\\/g,'/')}`;const p=new PrismaClient({datasources:{db:{url}}});let second;
 try{await p.$executeRawUnsafe('CREATE TABLE AuthSession (id INTEGER PRIMARY KEY,createdAt BIGINT NOT NULL,expiresAt BIGINT NOT NULL)');const now=Date.now();await p.$executeRawUnsafe('INSERT INTO AuthSession VALUES (1,?,?),(2,?,?)',now-3600000,now+30*86400000,now-60000,now+SESSION_DURATION_MS);
  await ensureIdleSessionPolicy(p);let rows=await p.$queryRawUnsafe('SELECT id,expiresAt FROM AuthSession ORDER BY id');assert.ok(Number(rows[0].expiresAt)<now);
  const renewed=now+SESSION_DURATION_MS;await p.$executeRawUnsafe('UPDATE AuthSession SET expiresAt=? WHERE id=2',renewed);second=new PrismaClient({datasources:{db:{url}}});await ensureIdleSessionPolicy(second);rows=await second.$queryRawUnsafe('SELECT expiresAt FROM AuthSession WHERE id=2');assert.equal(Number(rows[0].expiresAt),renewed);
 }finally{if(second)await second.$disconnect();await p.$disconnect();}
});
