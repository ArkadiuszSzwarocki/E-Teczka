"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.USAGE_WINDOW_MS = exports.PLAN_LIMITS = void 0;
exports.refreshPlanPolicy = refreshPlanPolicy;
exports.activePlan = activePlan;
exports.trialEnd = trialEnd;
exports.trialAvailable = trialAvailable;
const planCatalog_1 = require("./planCatalog");
exports.PLAN_LIMITS = {
    free: { documents: 200, tags: 3, cameraScan: 50, printerScan: 50, merge: 10 },
    standard: { documents: 400, tags: 6, cameraScan: 100, printerScan: 100, merge: 20 },
    premium: { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null },
};
exports.USAGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
function refreshPlanPolicy() { const catalog = (0, planCatalog_1.getCatalog)(); for (const id of ['free', 'standard', 'premium'])
    Object.assign(exports.PLAN_LIMITS[id], catalog.plans[id].limits); exports.USAGE_WINDOW_MS = catalog.usageDays * 86400000; }
refreshPlanPolicy();
function activePlan(plan, status, cancelAtPeriodEnd = false, currentPeriodEnd, now = new Date()) {
    if (!['active', 'trialing'].includes(status || '') || (cancelAtPeriodEnd && currentPeriodEnd && currentPeriodEnd <= now))
        return 'free';
    return plan === 'premium' || plan === 'standard' ? plan : 'free';
}
function trialEnd(feature, startedAt) {
    if (feature === 'ocr')
        return new Date(startedAt.getTime() + (0, planCatalog_1.getCatalog)().ocrTrialDays * 24 * 60 * 60 * 1000);
    // Add two calendar months, clamping dates such as 31 January to the last day of March.
    const end = new Date(startedAt);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + (0, planCatalog_1.getCatalog)().backupTrialMonths);
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, lastDay));
    return end;
}
function trialAvailable(plan, feature, startedAt, now = new Date()) {
    return (0, planCatalog_1.getCatalog)().plans[plan][feature === 'ocr' ? 'ocr' : 'cloudBackup'] || (startedAt <= now && now < trialEnd(feature, startedAt));
}
