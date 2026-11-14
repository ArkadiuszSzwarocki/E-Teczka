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
exports.getPlanUsage = getPlanUsage;
const devPlans_1 = require("./devPlans");
const planLedger_1 = require("./planLedger");
const planPolicy_1 = require("./planPolicy");
const tagOwnership_1 = require("./tagOwnership");
function getPlanUsage(db_1, ownerKey_1, ownerId_1) {
    return __awaiter(this, arguments, void 0, function* (db, ownerKey, ownerId, now = new Date()) {
        const plan = yield (0, planLedger_1.getPlan)(db, ownerKey, now);
        yield (0, planLedger_1.ensurePlanLedger)(db);
        yield (0, tagOwnership_1.prepareTags)(db);
        const key = (0, devPlans_1.accountingKey)(ownerKey);
        const since = now.getTime() - planPolicy_1.USAGE_WINDOW_MS;
        const rows = yield db.$queryRaw `
    SELECT feature, SUM(amount) AS used, CAST(MIN(usedAt) AS TEXT) AS oldest FROM PlanUsage
    WHERE ownerKey = ${key} AND usedAt > ${since} GROUP BY feature`;
        const quota = (used, limit, nextRenewal = null) => ({ used, limit, remaining: limit === null ? null : Math.max(0, limit - used), nextRenewal });
        const metered = (feature) => {
            const row = rows.find(item => item.feature === feature);
            return quota(Number((row === null || row === void 0 ? void 0 : row.used) || 0), planPolicy_1.PLAN_LIMITS[plan][feature], (row === null || row === void 0 ? void 0 : row.oldest) ? new Date(Number(row.oldest) + planPolicy_1.USAGE_WINDOW_MS) : null);
        };
        const [documents, tags, ocr, cloudBackup] = yield Promise.all([
            db.document.count({ where: { folder: { ownerId } } }), (0, tagOwnership_1.tagIds)(db, ownerId),
            (0, planLedger_1.featureTrial)(db, ownerKey, 'ocr', false, now), (0, planLedger_1.featureTrial)(db, ownerKey, 'cloudBackup', false, now),
        ]);
        return { plan, developmentOverride: (0, devPlans_1.devPlan)(ownerKey) !== undefined,
            documents: quota(documents, planPolicy_1.PLAN_LIMITS[plan].documents), tags: quota(tags.length, planPolicy_1.PLAN_LIMITS[plan].tags),
            cameraScan: metered('cameraScan'), printerScan: metered('printerScan'), merge: metered('merge'),
            ocr, cloudBackup };
    });
}
