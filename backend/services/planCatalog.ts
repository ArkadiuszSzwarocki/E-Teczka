import fs from 'node:fs';
import path from 'node:path';
export const planIds = ['free', 'standard', 'premium'] as const;
export type CatalogPlan = typeof planIds[number];
export const limitKeys = ['documents', 'tags', 'cameraScan', 'printerScan', 'merge'] as const;
export type PlanSettings = { name: string; ocr: boolean; cloudBackup: boolean; premiumTools: boolean; monthly: number; yearly: number; mobileDevices: number; accountDevices: number | null; limits: Record<typeof limitKeys[number], number | null> };
export type Promotion = { id: string; name: string; plan: CatalogPlan; interval: 'monthly' | 'yearly'; percent: number; startsAt: string; endsAt: string; enabled: boolean };
export type Catalog = { version: 1; usageDays: number; ocrTrialDays: number; backupTrialMonths: number; plans: Record<CatalogPlan, PlanSettings>; promotions: Promotion[] };
export const defaultCatalog: Catalog = { version: 1, usageDays: 7, ocrTrialDays: 14, backupTrialMonths: 2, plans: {
 free: { name: 'Darmowy', ocr: false, cloudBackup: false, premiumTools: false, monthly: 0, yearly: 0, mobileDevices: 1, accountDevices: 1, limits: { documents: 200, tags: 3, cameraScan: 50, printerScan: 50, merge: 10 } },
 standard: { name: 'Standard', ocr: false, cloudBackup: false, premiumTools: false, monthly: 499, yearly: 4990, mobileDevices: 1, accountDevices: 2, limits: { documents: 400, tags: 6, cameraScan: 100, printerScan: 100, merge: 20 } },
 premium: { name: 'Premium', ocr: true, cloudBackup: true, premiumTools: true, monthly: 999, yearly: 9990, mobileDevices: 1, accountDevices: null, limits: { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null } }
}, promotions: [] };
const catalogDirectory = () => path.join(process.cwd(), 'security');
const catalogFile = () => path.join(catalogDirectory(), 'developer-plan-catalog.json');
export function catalogEnabled() { return process.env.ETECZKA_DEV_PLANS === '1' && process.env.NODE_ENV !== 'production'; }
export function validateCatalog(value: unknown): Catalog {
 const data = value as Catalog;
 const integer = (n: unknown, min: number, max: number) => Number.isSafeInteger(n) && Number(n) >= min && Number(n) <= max;
 if (!data || data.version !== 1 || !integer(data.usageDays, 1, 365) || !integer(data.ocrTrialDays, 0, 3650) || !integer(data.backupTrialMonths, 0, 120) || !data.plans || !Array.isArray(data.promotions) || data.promotions.length > 100) throw new Error('Nieprawidłowe okresy lub format konfiguracji.');
 for (const id of planIds) {
  const p = data.plans[id];
  if (!p || typeof p.ocr !== 'boolean' || typeof p.cloudBackup !== 'boolean' || typeof p.premiumTools !== 'boolean' || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || !integer(p.monthly, 0, 100000000) || !integer(p.yearly, 0, 100000000) || !integer(p.mobileDevices, 1, 10000) || !(p.accountDevices === null || integer(p.accountDevices, 1, 10000)) || !p.limits) throw new Error('Nieprawidłowe ustawienia planu.');
  for (const key of limitKeys) if (!(p.limits[key] === null || integer(p.limits[key], 0, 100000000))) throw new Error('Limity muszą być nieujemnymi liczbami całkowitymi lub bez limitu.');
 }
 if (data.plans.free.monthly || data.plans.free.yearly) throw new Error('Plan Darmowy musi pozostać bezpłatny.');
 const ids = new Set<string>();
 for (const promo of data.promotions) {
  if (!promo || typeof promo.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(promo.id) || ids.has(promo.id) || typeof promo.name !== 'string' || !promo.name.trim() || promo.name.length > 100 || !planIds.includes(promo.plan) || promo.plan === 'free' || !['monthly', 'yearly'].includes(promo.interval) || !integer(promo.percent, 1, 100) || typeof promo.enabled !== 'boolean' || !Number.isFinite(Date.parse(promo.startsAt)) || !Number.isFinite(Date.parse(promo.endsAt)) || Date.parse(promo.startsAt) >= Date.parse(promo.endsAt)) throw new Error('Nieprawidłowa promocja: sprawdź nazwę, rabat i daty.');
  ids.add(promo.id);
 }
 return JSON.parse(JSON.stringify(data));
}
let cached: Catalog | undefined;
export function getCatalog(): Catalog {
 if (!catalogEnabled()) return structuredClone(defaultCatalog);
 if (!cached) { try { cached = validateCatalog(JSON.parse(fs.readFileSync(catalogFile(), 'utf8'))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Nie udało się odczytać katalogu planów; użyto ustawień domyślnych.'); cached = structuredClone(defaultCatalog); } }
 return structuredClone(cached);
}
export function saveCatalog(value: unknown) { const validated = validateCatalog(value); fs.mkdirSync(catalogDirectory(), { recursive: true }); fs.writeFileSync(catalogFile() + '.tmp', JSON.stringify(validated, null, 2), { mode: 0o600 }); fs.renameSync(catalogFile() + '.tmp', catalogFile()); cached = validated; return getCatalog(); }
export function quote(plan: CatalogPlan, interval: 'monthly' | 'yearly', now = new Date(), catalog = getCatalog()) {
 const base = catalog.plans[plan][interval];
 const promos = catalog.promotions.filter(p => p.enabled && p.plan === plan && p.interval === interval && Date.parse(p.startsAt) <= now.getTime() && now.getTime() < Date.parse(p.endsAt));
 const promotion = promos.sort((a,b) => b.percent - a.percent || a.id.localeCompare(b.id))[0] || null;
 return { base, amount: promotion ? Math.round(base * (100 - promotion.percent) / 100) : base, promotion, currency: 'PLN' };
}
