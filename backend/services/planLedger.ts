import type { Prisma, PrismaClient } from '@prisma/client';
import { accountingKey, devPlan } from './devPlans';
import { activePlan, PLAN_LIMITS, trialAvailable, trialEnd, USAGE_WINDOW_MS, type MeteredFeature, type Plan, type TrialFeature } from './planPolicy';

type Db = PrismaClient | Prisma.TransactionClient;
export class PlanLimitError extends Error {
  readonly code = 'PLAN_LIMIT_REACHED';
  constructor(public readonly feature: string, public readonly limit: number, public readonly resetsAt?: Date) { super(`Osiągnięto limit dla funkcji ${feature} (${limit}).`); }
}
/** Idempotent startup creates only independent tables and never modifies existing records. */
export async function ensurePlanLedger(db: Db): Promise<void> {
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanTrial (ownerKey TEXT NOT NULL, feature TEXT NOT NULL, startedAt BIGINT NOT NULL, PRIMARY KEY (ownerKey, feature))');
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanUsage (ownerKey TEXT NOT NULL, feature TEXT NOT NULL, operationId TEXT NOT NULL, amount INTEGER NOT NULL, usedAt BIGINT NOT NULL, PRIMARY KEY (ownerKey, feature, operationId))');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS PlanUsage_window_idx ON PlanUsage(ownerKey, feature, usedAt)');
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanPrinterClaim (ownerKey TEXT NOT NULL, jobId TEXT NOT NULL, draftId TEXT NOT NULL, PRIMARY KEY(ownerKey, jobId))');
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanScanReceipt (ownerKey TEXT NOT NULL, draftId TEXT NOT NULL, documentId INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(ownerKey, draftId))');
}
export async function getPlan(db: Db, ownerKey: string, now = new Date()): Promise<Plan> {
  const override = devPlan(ownerKey); if (override) return override;
  const subscription = await db.subscription.findUnique({ where: { ownerKey } });
  return activePlan(subscription?.plan, subscription?.status, subscription?.cancelAtPeriodEnd, subscription?.currentPeriodEnd, now);
}
/** Check or explicitly start a trial. Read-only checks never start the clock. */
export async function featureTrial(db: Db, ownerKey: string, feature: TrialFeature, start: boolean, now = new Date()) {
  const plan = await getPlan(db, ownerKey, now);
  if (plan === 'premium') return { allowed: true, startedAt: null, endsAt: null };
  await ensurePlanLedger(db);
  ownerKey = accountingKey(ownerKey);
  if (start) await db.$executeRaw`INSERT OR IGNORE INTO PlanTrial(ownerKey, feature, startedAt) VALUES (${ownerKey}, ${feature}, ${now.getTime()})`;
  const rows = await db.$queryRaw<Array<{ startedAt: bigint | number }>>`SELECT CAST(startedAt AS TEXT) AS startedAt FROM PlanTrial WHERE ownerKey = ${ownerKey} AND feature = ${feature}`;
  if (!rows.length) return { allowed: false, startedAt: null, endsAt: null };
  const startedAt = new Date(Number(rows[0].startedAt));
  return { allowed: trialAvailable(plan, feature, startedAt, now), startedAt, endsAt: trialEnd(feature, startedAt) };
}
/** Must be called in the same write transaction as the operation being metered. */
export async function consumeUsage(db: Prisma.TransactionClient, ownerKey: string, plan: Plan, feature: MeteredFeature, operationId: string, amount: number, now = new Date()): Promise<void> {
  ownerKey = accountingKey(ownerKey);
  if (!operationId || !Number.isSafeInteger(amount) || amount < 1) throw new Error('Nieprawidłowe dane licznika.');
  const previous = await db.$queryRaw<Array<{ amount: bigint | number }>>`SELECT amount FROM PlanUsage WHERE ownerKey = ${ownerKey} AND feature = ${feature} AND operationId = ${operationId}`;
  if (previous.length) { if (Number(previous[0].amount) !== amount) throw new Error('Identyfikator operacji został użyty z inną liczbą.'); return; }
  const limit = PLAN_LIMITS[plan][feature];
  if (limit !== null) {
    const since = now.getTime() - USAGE_WINDOW_MS;
    const rows = await db.$queryRaw<Array<{ used: bigint | number; oldest: bigint | number | null }>>`SELECT COALESCE(SUM(amount), 0) AS used, CAST(MIN(usedAt) AS TEXT) AS oldest FROM PlanUsage WHERE ownerKey = ${ownerKey} AND feature = ${feature} AND usedAt > ${since}`;
    if (Number(rows[0].used) + amount > limit) throw new PlanLimitError(feature, limit, rows[0].oldest === null ? undefined : new Date(Number(rows[0].oldest) + USAGE_WINDOW_MS));
  }
  await db.$executeRaw`INSERT INTO PlanUsage(ownerKey, feature, operationId, amount, usedAt) VALUES (${ownerKey}, ${feature}, ${operationId}, ${amount}, ${now.getTime()})`;
}

/** Counts all stored documents, including archive and trash, so users can free capacity by emptying trash. */
export async function checkDocumentCapacity(db: Db, ownerId: number, plan: Plan, amount: number): Promise<void> {
  const limit = PLAN_LIMITS[plan].documents;
  if (limit === null) return;
  const count = await db.document.count({ where: { folder: { ownerId } } });
  if (count + amount > limit) throw new PlanLimitError('dokumenty', limit);
}

export type BackupPlanState = { trials: Array<{ feature: TrialFeature; startedAt: number }>; usage: Array<{ feature: MeteredFeature; operationId: string; amount: number; usedAt: number }> };
export async function exportPlanState(db: Db, ownerKey: string): Promise<BackupPlanState> {
  await ensurePlanLedger(db);
  const trials = await db.$queryRaw<Array<{ feature: TrialFeature; startedAt: string }>>`SELECT feature, CAST(startedAt AS TEXT) AS startedAt FROM PlanTrial WHERE ownerKey = ${ownerKey}`;
  const usage = await db.$queryRaw<Array<{ feature: MeteredFeature; operationId: string; amount: number; usedAt: string }>>`SELECT feature, operationId, amount, CAST(usedAt AS TEXT) AS usedAt FROM PlanUsage WHERE ownerKey = ${ownerKey}`;
  return { trials: trials.map(item => ({ ...item, startedAt: Number(item.startedAt) })), usage: usage.map(item => ({ ...item, amount: Number(item.amount), usedAt: Number(item.usedAt) })) };
}
export function parseBackupPlanState(value: unknown): BackupPlanState | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || !Array.isArray((value as BackupPlanState).trials) || !Array.isArray((value as BackupPlanState).usage)) throw new Error('Nieprawidłowy stan planu w kopii.');
  const state = value as BackupPlanState;
  if (state.trials.length > 2 || state.usage.length > 100000 || state.trials.some(item => !item || !['ocr', 'cloudBackup'].includes(item.feature) || !Number.isSafeInteger(item.startedAt) || item.startedAt < 0) || state.usage.some(item => !item || !['cameraScan', 'printerScan', 'merge'].includes(item.feature) || typeof item.operationId !== 'string' || !item.operationId || item.operationId.length > 128 || !Number.isSafeInteger(item.amount) || item.amount < 1 || !Number.isSafeInteger(item.usedAt) || item.usedAt < 0)) throw new Error('Nieprawidłowy stan planu w kopii.');
  return state;
}
/** Merge rather than reset trials and counters when restoring older snapshots. */
export async function mergePlanState(db: Prisma.TransactionClient, ownerKey: string, state: BackupPlanState | null) {
  if (!state) return;
  for (const item of state.trials) await db.$executeRaw`INSERT INTO PlanTrial(ownerKey, feature, startedAt) VALUES (${ownerKey}, ${item.feature}, ${item.startedAt}) ON CONFLICT(ownerKey, feature) DO UPDATE SET startedAt = MIN(startedAt, excluded.startedAt)`;
  for (const item of state.usage) await db.$executeRaw`INSERT OR IGNORE INTO PlanUsage(ownerKey, feature, operationId, amount, usedAt) VALUES (${ownerKey}, ${item.feature}, ${item.operationId}, ${item.amount}, ${item.usedAt})`;
}

/** Printer pages count only when backed by a successful server-issued scan job. */
export async function claimPrinterPages(db: Prisma.TransactionClient, ownerKey: string, draftId: string, jobIds: string[]): Promise<number> {
  ownerKey = accountingKey(ownerKey);
  if (new Set(jobIds).size !== jobIds.length) throw new Error('Powtórzona strona drukarki.');
  for (const jobId of jobIds) {
    const jobs = await db.$queryRaw<Array<{ operationId: string }>>`SELECT operationId FROM PlanUsage WHERE ownerKey = ${ownerKey} AND feature = ${'printerScan'} AND operationId = ${jobId}`;
    if (!jobs.length) throw new Error('Nie można potwierdzić pochodzenia strony z drukarki.');
    const claims = await db.$queryRaw<Array<{ draftId: string }>>`SELECT draftId FROM PlanPrinterClaim WHERE ownerKey = ${ownerKey} AND jobId = ${jobId}`;
    if (claims.length && claims[0].draftId !== draftId) throw new Error('Strona drukarki została już użyta w innym dokumencie.');
    await db.$executeRaw`INSERT OR IGNORE INTO PlanPrinterClaim(ownerKey,jobId,draftId) VALUES (${ownerKey},${jobId},${draftId})`;
  }
  return jobIds.length;
}
