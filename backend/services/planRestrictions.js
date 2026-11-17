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
exports.activeDocumentIds = activeDocumentIds;
exports.activeTagIds = activeTagIds;
const planPolicy_1 = require("./planPolicy");
const centralPlanLedger_1 = require("./centralPlanLedger");
const centralEntitlements_1 = require("./centralEntitlements");
function activeDocumentIds(db, ownerId, plan) {
    return __awaiter(this, void 0, void 0, function* () {
        const central = (0, centralPlanLedger_1.centralOwner)(`user:${ownerId}`);
        const limit = central ? (yield (0, centralEntitlements_1.centralPlanRequest)(central, '/ledger/status')).allowance.documents : planPolicy_1.PLAN_LIMITS[plan].documents;
        if (limit === null)
            return null;
        const documents = yield db.document.findMany({ where: { folder: { ownerId } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit, select: { id: true } });
        return new Set(documents.map(document => document.id));
    });
}
function activeTagIds(db, ownerId, plan) {
    return __awaiter(this, void 0, void 0, function* () {
        const central = (0, centralPlanLedger_1.centralOwner)(`user:${ownerId}`);
        const limit = central ? (yield (0, centralEntitlements_1.centralPlanRequest)(central, '/ledger/status')).allowance.tags : planPolicy_1.PLAN_LIMITS[plan].tags;
        if (limit === null)
            return null;
        const tags = yield db.$queryRaw `SELECT t.id FROM Tag t JOIN PlanTagOwner o ON o.tagId=t.id WHERE o.ownerId=${ownerId} ORDER BY t.createdAt ASC,t.id ASC LIMIT ${limit}`;
        return new Set(tags.map(tag => Number(tag.id)));
    });
}
