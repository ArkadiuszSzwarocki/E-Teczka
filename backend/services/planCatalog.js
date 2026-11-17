"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultCatalog = exports.limitKeys = exports.planIds = void 0;
exports.catalogEnabled = catalogEnabled;
exports.validateCatalog = validateCatalog;
exports.applyCentralCatalog = applyCentralCatalog;
exports.getCatalog = getCatalog;
exports.saveCatalog = saveCatalog;
exports.quote = quote;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.planIds = ['free', 'standard', 'premium', 'family', 'business'];
exports.limitKeys = ['documents', 'tags', 'cameraScan', 'printerScan', 'merge'];
exports.defaultCatalog = { version: 1, usageDays: 7, ocrTrialDays: 14, backupTrialMonths: 2, plans: {
        free: { name: 'Darmowy', ocr: false, cloudBackup: false, premiumTools: false, monthly: 0, yearly: 0, mobileDevices: 1, accountDevices: 1, limits: { documents: 200, tags: 3, cameraScan: 50, printerScan: 50, merge: 10 } },
        standard: { name: 'Standard', ocr: false, cloudBackup: false, premiumTools: false, monthly: 499, yearly: 4990, mobileDevices: 1, accountDevices: 2, limits: { documents: 400, tags: 6, cameraScan: 100, printerScan: 100, merge: 20 } },
        premium: { name: 'Premium', ocr: true, cloudBackup: true, premiumTools: true, monthly: 999, yearly: 9990, mobileDevices: 1, accountDevices: null, limits: { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null } },
        family: { name: 'Rodzinny', ocr: true, cloudBackup: true, premiumTools: true, monthly: 1499, yearly: 14990, mobileDevices: 4, accountDevices: null, limits: { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null } },
        business: { name: 'Firmowy', ocr: true, cloudBackup: true, premiumTools: true, monthly: 2999, yearly: 29990, mobileDevices: 10, accountDevices: null, limits: { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null } }
    }, promotions: [] };
const catalogDirectory = () => node_path_1.default.join(process.cwd(), 'security');
const catalogFile = () => node_path_1.default.join(catalogDirectory(), 'developer-plan-catalog.json');
function catalogEnabled() { return process.env.ETECZKA_DEV_PLANS === '1' && process.env.NODE_ENV !== 'production'; }
function validateCatalog(value) {
    const raw = value;
    const data = (raw && raw.plans ? Object.assign(Object.assign({}, raw), { plans: Object.assign(Object.assign({}, raw.plans), { family: raw.plans.family || structuredClone(exports.defaultCatalog.plans.family), business: raw.plans.business || structuredClone(exports.defaultCatalog.plans.business) }) }) : raw);
    const integer = (n, min, max) => Number.isSafeInteger(n) && Number(n) >= min && Number(n) <= max;
    if (!data || data.version !== 1 || !integer(data.usageDays, 1, 365) || !integer(data.ocrTrialDays, 0, 3650) || !integer(data.backupTrialMonths, 0, 120) || !data.plans || !Array.isArray(data.promotions) || data.promotions.length > 100)
        throw new Error('Nieprawidłowe okresy lub format konfiguracji.');
    for (const id of exports.planIds) {
        const p = data.plans[id];
        if (!p || typeof p.ocr !== 'boolean' || typeof p.cloudBackup !== 'boolean' || typeof p.premiumTools !== 'boolean' || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || !integer(p.monthly, 0, 100000000) || !integer(p.yearly, 0, 100000000) || !integer(p.mobileDevices, 1, 10000) || !(p.accountDevices === null || integer(p.accountDevices, 1, 10000)) || !p.limits)
            throw new Error('Nieprawidłowe ustawienia planu.');
        for (const key of exports.limitKeys)
            if (!(p.limits[key] === null || integer(p.limits[key], 0, 100000000)))
                throw new Error('Limity muszą być nieujemnymi liczbami całkowitymi lub bez limitu.');
    }
    if (data.plans.free.monthly || data.plans.free.yearly)
        throw new Error('Plan Darmowy musi pozostać bezpłatny.');
    const ids = new Set();
    for (const promo of data.promotions) {
        if (!promo || typeof promo.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(promo.id) || ids.has(promo.id) || typeof promo.name !== 'string' || !promo.name.trim() || promo.name.length > 100 || !exports.planIds.includes(promo.plan) || promo.plan === 'free' || !['monthly', 'yearly'].includes(promo.interval) || !integer(promo.percent, 1, 100) || typeof promo.enabled !== 'boolean' || !Number.isFinite(Date.parse(promo.startsAt)) || !Number.isFinite(Date.parse(promo.endsAt)) || Date.parse(promo.startsAt) >= Date.parse(promo.endsAt))
            throw new Error('Nieprawidłowa promocja: sprawdź nazwę, rabat i daty.');
        ids.add(promo.id);
    }
    return JSON.parse(JSON.stringify(data));
}
let cached;
let centralCatalog;
const centralCacheFile = () => node_path_1.default.join(catalogDirectory(), 'central-plan-catalog.cache.json');
function applyCentralCatalog(value) {
    const incoming = validateCatalog(value);
    const revision = Number((value === null || value === void 0 ? void 0 : value.revision) || 0), prior = Number((centralCatalog === null || centralCatalog === void 0 ? void 0 : centralCatalog.revision) || 0);
    if (!centralCatalog || revision >= prior) {
        centralCatalog = incoming;
        try {
            node_fs_1.default.mkdirSync(catalogDirectory(), { recursive: true });
            node_fs_1.default.writeFileSync(centralCacheFile() + '.tmp', JSON.stringify(incoming), { mode: 0o600 });
            node_fs_1.default.renameSync(centralCacheFile() + '.tmp', centralCacheFile());
        }
        catch (_a) { }
    }
    return structuredClone(centralCatalog);
}
function getCatalog() {
    if (centralCatalog)
        return structuredClone(centralCatalog);
    if (!catalogEnabled()) {
        try {
            centralCatalog = validateCatalog(JSON.parse(node_fs_1.default.readFileSync(centralCacheFile(), 'utf8')));
            return structuredClone(centralCatalog);
        }
        catch (_a) {
            return structuredClone(exports.defaultCatalog);
        }
    }
    try {
        cached = validateCatalog(JSON.parse(node_fs_1.default.readFileSync(catalogFile(), 'utf8')));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            console.error('Nie udało się odczytać katalogu planów; użyto ustawień domyślnych.');
        cached = structuredClone(exports.defaultCatalog);
    }
    return structuredClone(cached);
}
function saveCatalog(value) { const validated = validateCatalog(value); node_fs_1.default.mkdirSync(catalogDirectory(), { recursive: true }); node_fs_1.default.writeFileSync(catalogFile() + '.tmp', JSON.stringify(validated, null, 2), { mode: 0o600 }); node_fs_1.default.renameSync(catalogFile() + '.tmp', catalogFile()); cached = validated; return getCatalog(); }
function quote(plan, interval, now = new Date(), catalog = getCatalog()) {
    const base = catalog.plans[plan][interval];
    const promos = catalog.promotions.filter(p => p.enabled && p.plan === plan && p.interval === interval && Date.parse(p.startsAt) <= now.getTime() && now.getTime() < Date.parse(p.endsAt));
    const promotion = promos.sort((a, b) => b.percent - a.percent || a.id.localeCompare(b.id))[0] || null;
    return { base, amount: promotion ? Math.round(base * (100 - promotion.percent) / 100) : base, promotion, currency: 'PLN' };
}
