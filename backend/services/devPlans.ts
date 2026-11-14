import type { Plan } from './planPolicy';
const overrides = new Map<string, Plan>();
export function devPlansEnabled(): boolean {
  return process.env.ETECZKA_DEV_PLANS === '1' && process.env.NODE_ENV !== 'production' && (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
}
export function devPlan(ownerKey: string): Plan | undefined { return devPlansEnabled() ? overrides.get(ownerKey) : undefined; }
export function setDevPlan(ownerKey: string, plan: Plan | null): void { if (plan === null) overrides.delete(ownerKey); else overrides.set(ownerKey, plan); }
export function accountingKey(ownerKey: string): string { return devPlan(ownerKey) === undefined ? ownerKey : `dev-test:${ownerKey}`; }
