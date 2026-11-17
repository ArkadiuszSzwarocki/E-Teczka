"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanLimitError = void 0;
exports.ensurePlanLedger = ensurePlanLedger;
exports.getPlan = getPlan;
exports.featureTrial = featureTrial;
exports.consumeUsage = consumeUsage;
exports.checkDocumentCapacity = checkDocumentCapacity;
exports.checkTagCapacity = checkTagCapacity;
exports.exportPlanState = exportPlanState;
exports.parseBackupPlanState = parseBackupPlanState;
exports.mergePlanState = mergePlanState;
exports.copyDesktopPlanState = copyDesktopPlanState;
exports.claimPrinterPages = claimPrinterPages;
const planCatalog_1 = require("./planCatalog");
const centralEntitlements_1 = require("./centralEntitlements");
const centralEntitlements_2 = require("./centralEntitlements");
const centralPlanLedger_1 = require("./centralPlanLedger");
const devPlans_1 = require("./devPlans");
const devOverrides_1 = require("./devOverrides");
const planPolicy_1 = require("./planPolicy");
class PlanLimitError extends Error {
    constructor(feature, limit, resetsAt) {
        super(`Osiągnięto limit dla funkcji ${feature} (${limit}).`);
        this.feature = feature;
        this.limit = limit;
        this.resetsAt = resetsAt;
        this.code = 'PLAN_LIMIT_REACHED';
    }
}
exports.PlanLimitError = PlanLimitError;
/** Idempotent startup creates only independent tables and never modifies existing records. */
function ensurePlanLedger(db) {
    return __awaiter(this, void 0, void 0, function* () {
        yield db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanTrial (ownerKey TEXT NOT NULL, feature TEXT NOT NULL, startedAt BIGINT NOT NULL, PRIMARY KEY (ownerKey, feature))');
        yield db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanUsage (ownerKey TEXT NOT NULL, feature TEXT NOT NULL, operationId TEXT NOT NULL, amount INTEGER NOT NULL, usedAt BIGINT NOT NULL, PRIMARY KEY (ownerKey, feature, operationId))');
        yield db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS PlanUsage_window_idx ON PlanUsage(ownerKey, feature, usedAt)');
        yield db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanPrinterClaim (ownerKey TEXT NOT NULL, jobId TEXT NOT NULL, draftId TEXT NOT NULL, PRIMARY KEY(ownerKey, jobId))');
        yield db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanScanReceipt (ownerKey TEXT NOT NULL, draftId TEXT NOT NULL, documentId INTEGER NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(ownerKey, draftId))');
    });
}
const isPublicTestMode = () => process.env.ETECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
function getPlan(db_1, ownerKey_1) {
    return __awaiter(this, arguments, void 0, function* (db, ownerKey, now = new Date()) {
        const override = (0, devPlans_1.devPlan)(ownerKey);
        if (override)
            return override;
        if (isPublicTestMode() || (0, devOverrides_1.getDevOverrides)().bypassPlanLimits)
            return 'premium';
        const id = /^user:(\d+)$/.exec(ownerKey);
        if (id) {
            const central = yield (0, centralEntitlements_1.centralEntitlement)(Number(id[1]));
            if (central)
                return central.plan;
            if (yield (0, centralEntitlements_1.hasCentralLink)(db, Number(id[1])))
                return 'free';
        }
        const subscription = yield db.subscription.findUnique({ where: { ownerKey } });
        return (0, planPolicy_1.activePlan)(subscription === null || subscription === void 0 ? void 0 : subscription.plan, subscription === null || subscription === void 0 ? void 0 : subscription.status, subscription === null || subscription === void 0 ? void 0 : subscription.cancelAtPeriodEnd, subscription === null || subscription === void 0 ? void 0 : subscription.currentPeriodEnd, now);
    });
}
/** Check or explicitly start a trial. Read-only checks never start the clock. */
function featureTrial(db_1, ownerKey_1, feature_1, start_1) {
    return __awaiter(this, arguments, void 0, function* (db, ownerKey, feature, start, now = new Date()) {
        if (isPublicTestMode() && !(0, devPlans_1.devPlan)(ownerKey))
            return { allowed: true, startedAt: null, endsAt: null };
        const central = (0, centralPlanLedger_1.requireCentralPlanOwner)(ownerKey);
        if (central) {
            const result = yield (0, centralEntitlements_2.centralPlanRequest)(central, '/ledger/trial', { feature, start });
            return { allowed: result.allowed, startedAt: result.startedAt === null ? null : new Date(result.startedAt), endsAt: result.endsAt === null ? null : new Date(result.endsAt) };
        }
        const plan = yield getPlan(db, ownerKey, now);
        if ((0, planCatalog_1.getCatalog)().plans[plan][feature === 'ocr' ? 'ocr' : 'cloudBackup'])
            return { allowed: true, startedAt: null, endsAt: null };
        yield ensurePlanLedger(db);
        ownerKey = (0, devPlans_1.accountingKey)(ownerKey);
        if (start)
            yield db.$executeRaw `INSERT OR IGNORE INTO PlanTrial(ownerKey, feature, startedAt) VALUES (${ownerKey}, ${feature}, ${now.getTime()})`;
        const rows = yield db.$queryRaw `SELECT CAST(startedAt AS TEXT) AS startedAt FROM PlanTrial WHERE ownerKey = ${ownerKey} AND feature = ${feature}`;
        if (!rows.length)
            return { allowed: false, startedAt: null, endsAt: null };
        const startedAt = new Date(Number(rows[0].startedAt));
        return { allowed: (0, planPolicy_1.trialAvailable)(plan, feature, startedAt, now), startedAt, endsAt: (0, planPolicy_1.trialEnd)(feature, startedAt) };
    });
}
/** Must be called in the same write transaction as the operation being metered. */
function consumeUsage(db_1, ownerKey_1, plan_1, feature_1, operationId_1, amount_1) {
    return __awaiter(this, arguments, void 0, function* (db, ownerKey, plan, feature, operationId, amount, now = new Date()) {
        const central = (0, centralPlanLedger_1.requireCentralPlanOwner)(ownerKey);
        if (central) {
            const previous = yield db.$queryRaw `SELECT amount FROM PlanUsage WHERE ownerKey=${ownerKey} AND feature=${feature} AND operationId=${operationId}`;
            if (previous.length) {
                if (Number(previous[0].amount) !== amount)
                    throw new Error('Identyfikator operacji został użyty z inną liczbą.');
                return;
            }
            yield (0, centralPlanLedger_1.reserveCentralPlan)(db, central, feature, operationId, amount);
            yield db.$executeRaw `INSERT INTO PlanUsage(ownerKey,feature,operationId,amount,usedAt) VALUES (${ownerKey},${feature},${operationId},${amount},${now.getTime()})`;
            return;
        }
        ownerKey = (0, devPlans_1.accountingKey)(ownerKey);
        if (!operationId || !Number.isSafeInteger(amount) || amount < 1)
            throw new Error('Nieprawidłowe dane licznika.');
        const previous = yield db.$queryRaw `SELECT amount FROM PlanUsage WHERE ownerKey = ${ownerKey} AND feature = ${feature} AND operationId = ${operationId}`;
        if (previous.length) {
            if (Number(previous[0].amount) !== amount)
                throw new Error('Identyfikator operacji został użyty z inną liczbą.');
            return;
        }
        const limit = planPolicy_1.PLAN_LIMITS[plan][feature];
        if (limit !== null) {
            const since = now.getTime() - planPolicy_1.USAGE_WINDOW_MS;
            const rows = yield db.$queryRaw `SELECT COALESCE(SUM(amount), 0) AS used, CAST(MIN(usedAt) AS TEXT) AS oldest FROM PlanUsage WHERE ownerKey = ${ownerKey} AND feature = ${feature} AND usedAt > ${since}`;
            if (Number(rows[0].used) + amount > limit)
                throw new PlanLimitError(feature, limit, rows[0].oldest === null ? undefined : new Date(Number(rows[0].oldest) + planPolicy_1.USAGE_WINDOW_MS));
        }
        yield db.$executeRaw `INSERT INTO PlanUsage(ownerKey, feature, operationId, amount, usedAt) VALUES (${ownerKey}, ${feature}, ${operationId}, ${amount}, ${now.getTime()})`;
    });
}
/** Counts all stored documents, including archive and trash, so users can free capacity by emptying trash. */
function checkDocumentCapacity(db, ownerId, plan, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        const central = (0, centralPlanLedger_1.requireCentralPlanOwner)(`user:${ownerId}`);
        if (central) {
            yield (0, centralPlanLedger_1.reserveCentralPlan)(db, central, 'documents', (0, centralPlanLedger_1.centralResourceOperation)(), amount);
            return;
        }
        const limit = planPolicy_1.PLAN_LIMITS[plan].documents;
        if (limit === null)
            return;
        const count = yield db.document.count({ where: { folder: { ownerId } } });
        if (count + amount > limit)
            throw new PlanLimitError('dokumenty', limit);
    });
}
function checkTagCapacity(db_1, ownerId_1, plan_1, localCount_1) {
    return __awaiter(this, arguments, void 0, function* (db, ownerId, plan, localCount, amount = 1) { const central = (0, centralPlanLedger_1.requireCentralPlanOwner)(`user:${ownerId}`); if (central) {
        yield (0, centralPlanLedger_1.reserveCentralPlan)(db, central, 'tags', (0, centralPlanLedger_1.centralResourceOperation)(), amount);
        return;
    } const limit = planPolicy_1.PLAN_LIMITS[plan].tags; if (limit !== null && localCount + amount > limit)
        throw new PlanLimitError('tagi', limit); });
}
function exportPlanState(db, ownerKey) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensurePlanLedger(db);
        const trials = yield db.$queryRaw `SELECT feature, CAST(startedAt AS TEXT) AS startedAt FROM PlanTrial WHERE ownerKey = ${ownerKey}`;
        const usage = yield db.$queryRaw `SELECT feature, operationId, amount, CAST(usedAt AS TEXT) AS usedAt FROM PlanUsage WHERE ownerKey = ${ownerKey}`;
        return { trials: trials.map(item => (Object.assign(Object.assign({}, item), { startedAt: Number(item.startedAt) }))), usage: usage.map(item => (Object.assign(Object.assign({}, item), { amount: Number(item.amount), usedAt: Number(item.usedAt) }))) };
    });
}
function parseBackupPlanState(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'object' || !Array.isArray(value.trials) || !Array.isArray(value.usage))
        throw new Error('Nieprawidłowy stan planu w kopii.');
    const state = value;
    if (state.trials.length > 2 || state.usage.length > 100000 || state.trials.some(item => !item || !['ocr', 'cloudBackup'].includes(item.feature) || !Number.isSafeInteger(item.startedAt) || item.startedAt < 0) || state.usage.some(item => !item || !['cameraScan', 'printerScan', 'merge'].includes(item.feature) || typeof item.operationId !== 'string' || !item.operationId || item.operationId.length > 128 || !Number.isSafeInteger(item.amount) || item.amount < 1 || !Number.isSafeInteger(item.usedAt) || item.usedAt < 0))
        throw new Error('Nieprawidłowy stan planu w kopii.');
    return state;
}
/** Merge rather than reset trials and counters when restoring older snapshots. */
function mergePlanState(db, ownerKey, state) {
    return __awaiter(this, void 0, void 0, function* () {
        if ((0, centralPlanLedger_1.centralOwner)(ownerKey)) {
            (0, centralPlanLedger_1.markCentralInventoryDirty)();
            return;
        }
        if (!state)
            return;
        for (const item of state.trials)
            yield db.$executeRaw `INSERT INTO PlanTrial(ownerKey, feature, startedAt) VALUES (${ownerKey}, ${item.feature}, ${item.startedAt}) ON CONFLICT(ownerKey, feature) DO UPDATE SET startedAt = MIN(startedAt, excluded.startedAt)`;
        for (const item of state.usage)
            yield db.$executeRaw `INSERT OR IGNORE INTO PlanUsage(ownerKey, feature, operationId, amount, usedAt) VALUES (${ownerKey}, ${item.feature}, ${item.operationId}, ${item.amount}, ${item.usedAt})`;
    });
}
/** Keep existing trial dates and usage when the desktop owner receives an account. */
function copyDesktopPlanState(db, targetOwner) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensurePlanLedger(db);
        const source = 'desktop-local';
        yield db.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            const state = yield exportPlanState(tx, source);
            yield mergePlanState(tx, targetOwner, state);
            yield tx.$executeRaw `INSERT OR IGNORE INTO PlanPrinterClaim(ownerKey, jobId, draftId) SELECT ${targetOwner}, jobId, draftId FROM PlanPrinterClaim WHERE ownerKey = ${source}`;
            yield tx.$executeRaw `INSERT OR IGNORE INTO PlanScanReceipt(ownerKey, draftId, documentId, fingerprint) SELECT ${targetOwner}, draftId, documentId, fingerprint FROM PlanScanReceipt WHERE ownerKey = ${source}`;
        }));
    });
}
/** Printer pages count only when backed by a successful server-issued scan job. */
function claimPrinterPages(db, ownerKey, draftId, jobIds) {
    return __awaiter(this, void 0, void 0, function* () {
        ownerKey = (0, devPlans_1.accountingKey)(ownerKey);
        if (new Set(jobIds).size !== jobIds.length)
            throw new Error('Powtórzona strona drukarki.');
        for (const jobId of jobIds) {
            const jobs = yield db.$queryRaw `SELECT operationId FROM PlanUsage WHERE ownerKey = ${ownerKey} AND feature = ${'printerScan'} AND operationId = ${jobId}`;
            if (!jobs.length)
                throw new Error('Nie można potwierdzić pochodzenia strony z drukarki.');
            const claims = yield db.$queryRaw `SELECT draftId FROM PlanPrinterClaim WHERE ownerKey = ${ownerKey} AND jobId = ${jobId}`;
            if (claims.length && claims[0].draftId !== draftId)
                throw new Error('Strona drukarki została już użyta w innym dokumencie.');
            yield db.$executeRaw `INSERT OR IGNORE INTO PlanPrinterClaim(ownerKey,jobId,draftId) VALUES (${ownerKey},${jobId},${draftId})`;
        }
        return jobIds.length;
    });
}
