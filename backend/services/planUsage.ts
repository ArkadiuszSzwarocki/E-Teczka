import type { PrismaClient } from '@prisma/client';
import { accountingKey, devPlan } from './devPlans';
import { ensurePlanLedger, featureTrial, getPlan } from './planLedger';
import { PLAN_LIMITS, USAGE_WINDOW_MS, type MeteredFeature } from './planPolicy';
import { prepareTags, tagIds } from './tagOwnership';
import { centralOwner, recoverCentralPlanJournal, centralOfflineStatus } from './centralPlanLedger';
import { centralPlanRequest } from './centralEntitlements';

export async function getPlanUsage(db: PrismaClient, ownerKey: string, ownerId: number, now = new Date()) {
  const central=centralOwner(ownerKey);if(central){await prepareTags(db);await recoverCentralPlanJournal(db);const state=await centralPlanRequest(central,'/ledger/status');const [documents,tags,ocr,cloudBackup]=await Promise.all([db.document.count({where:{folder:{ownerId}}}),tagIds(db,ownerId),featureTrial(db,ownerKey,'ocr',false),featureTrial(db,ownerKey,'cloudBackup',false)]);const docLimit=typeof state?.documents?.limit==='number'?state.documents.limit:(typeof state?.allowance?.documents==='number'?state.allowance.documents:null);const tagLimit=typeof state?.tags?.limit==='number'?state.tags.limit:(typeof state?.allowance?.tags==='number'?state.allowance.tags:null);const localQuota=(used:number,limit:number|null,nextRenewal:Date|null=null)=>({used,limit,remaining:limit===null?null:Math.max(0,limit-used),nextRenewal});return {...state,documents:localQuota(documents,docLimit,state?.documents?.nextRenewal??null),tags:localQuota(tags.length,tagLimit,state?.tags?.nextRenewal??null),developmentOverride:false,source:'central',offlinePool:centralOfflineStatus(central),ocr,cloudBackup};}
  const plan = await getPlan(db, ownerKey, now);
  await ensurePlanLedger(db);
  await prepareTags(db);
  const key = accountingKey(ownerKey);
  const since = now.getTime() - USAGE_WINDOW_MS;
  const rows = await db.$queryRaw<Array<{ feature: MeteredFeature; used: bigint | number; oldest: string | null }>>`
    SELECT feature, SUM(amount) AS used, CAST(MIN(usedAt) AS TEXT) AS oldest FROM PlanUsage
    WHERE ownerKey = ${key} AND usedAt > ${since} GROUP BY feature`;
  const quota = (used: number, limit: number | null, nextRenewal: Date | null = null) => ({ used, limit, remaining: limit === null ? null : Math.max(0, limit - used), nextRenewal });
  const metered = (feature: MeteredFeature) => {
    const row = rows.find(item => item.feature === feature);
    return quota(Number(row?.used || 0), PLAN_LIMITS[plan][feature], row?.oldest ? new Date(Number(row.oldest) + USAGE_WINDOW_MS) : null);
  };
  const [documents, tags, ocr, cloudBackup] = await Promise.all([
    db.document.count({ where: { folder: { ownerId } } }), tagIds(db, ownerId),
    featureTrial(db, ownerKey, 'ocr', false, now), featureTrial(db, ownerKey, 'cloudBackup', false, now),
  ]);
  return { plan, developmentOverride: devPlan(ownerKey) !== undefined,
    documents: quota(documents, PLAN_LIMITS[plan].documents), tags: quota(tags.length, PLAN_LIMITS[plan].tags),
    cameraScan: metered('cameraScan'), printerScan: metered('printerScan'), merge: metered('merge'),
    ocr, cloudBackup };
}
