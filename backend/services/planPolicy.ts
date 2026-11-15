import { getCatalog } from './planCatalog';
export type Plan = 'free' | 'standard' | 'premium';
export type MeteredFeature = 'cameraScan' | 'printerScan' | 'merge';
export type TrialFeature = 'ocr' | 'cloudBackup';
export const PLAN_LIMITS: Record<Plan, { documents: number | null; tags: number | null; cameraScan: number | null; printerScan: number | null; merge: number | null }> = {
  free: { documents: 200, tags: 3, cameraScan: 50, printerScan: 50, merge: 10 },
  standard: { documents: 400, tags: 6, cameraScan: 100, printerScan: 100, merge: 20 },
  premium: { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null },
};
export let USAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export function refreshPlanPolicy() { const catalog = getCatalog(); for (const id of ['free','standard','premium'] as const) Object.assign(PLAN_LIMITS[id], catalog.plans[id].limits); USAGE_WINDOW_MS = catalog.usageDays * 86400000; }
refreshPlanPolicy();
export function activePlan(plan: string | null | undefined, status: string | null | undefined, cancelAtPeriodEnd = false, currentPeriodEnd?: Date | null, now = new Date()): Plan {
  if (!['active', 'trialing'].includes(status || '') || (cancelAtPeriodEnd && currentPeriodEnd && currentPeriodEnd <= now)) return 'free';
  return plan === 'premium' || plan === 'standard' ? plan : 'free';
}
export function trialEnd(feature: TrialFeature, startedAt: Date): Date {
  if (feature === 'ocr') return new Date(startedAt.getTime() + getCatalog().ocrTrialDays * 24 * 60 * 60 * 1000);
  // Add two calendar months, clamping dates such as 31 January to the last day of March.
  const end = new Date(startedAt); const day = end.getUTCDate(); end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + getCatalog().backupTrialMonths);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate(); end.setUTCDate(Math.min(day, lastDay)); return end;
}
export function trialAvailable(plan: Plan, feature: TrialFeature, startedAt: Date, now = new Date()): boolean {
  return getCatalog().plans[plan][feature === 'ocr' ? 'ocr' : 'cloudBackup'] || (startedAt <= now && now < trialEnd(feature, startedAt));
}
