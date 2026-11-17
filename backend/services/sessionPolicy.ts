import type {PrismaClient} from '@prisma/client';
export const SESSION_DURATION_MS = 20 * 60 * 1000;
export function activeSessionWhere(now = new Date()) { return { expiresAt: { gt: now } }; }
export function effectiveSessionExpiry(_createdAt: Date, expiresAt: Date) { return expiresAt; }
const upgrades=new WeakMap<object,Promise<void>>();
/** Cap historical fixed/long sessions once; later activity extensions survive restarts. */
export function ensureIdleSessionPolicy(prisma:PrismaClient):Promise<void>{
 const db=prisma as any;if(typeof db.$executeRawUnsafe!=='function'||typeof db.$transaction!=='function')return Promise.resolve();
 let pending=upgrades.get(prisma);if(!pending){pending=db.$transaction(async(tx:any)=>{
  await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SessionPolicyMigration (name TEXT PRIMARY KEY)');
  const inserted=await tx.$executeRawUnsafe("INSERT OR IGNORE INTO SessionPolicyMigration(name) VALUES ('idle-v1')");
  if(inserted)await tx.$executeRawUnsafe(`UPDATE AuthSession SET expiresAt=MIN(expiresAt, CASE WHEN typeof(createdAt) IN ('integer','real') THEN createdAt+${SESSION_DURATION_MS} ELSE CAST(strftime('%s',createdAt) AS INTEGER)*1000+${SESSION_DURATION_MS} END)`);
 }).then(()=>undefined);upgrades.set(prisma,pending!);}return pending!;
}
