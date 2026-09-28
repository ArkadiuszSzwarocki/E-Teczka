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
exports.retentionExpired = retentionExpired;
exports.applyRetentionPolicy = applyRetentionPolicy;
function retentionExpired(document) {
    const expiry = new Date(document.createdAt);
    if (document.retentionUnit === 'years')
        expiry.setFullYear(expiry.getFullYear() + document.retentionValue);
    else if (document.retentionUnit === 'months')
        expiry.setMonth(expiry.getMonth() + document.retentionValue);
    else if (document.retentionUnit === 'days')
        expiry.setDate(expiry.getDate() + document.retentionValue);
    else if (document.retentionUnit === 'minutes')
        expiry.setMinutes(expiry.getMinutes() + document.retentionValue);
    else
        return false;
    return expiry.getTime() <= Date.now();
}
/** Applies the lifecycle rule independently of the desktop window. */
function applyRetentionPolicy(prisma) {
    return __awaiter(this, void 0, void 0, function* () {
        const candidates = yield prisma.document.findMany({
            where: { retentionEnabled: true, isArchived: false, isDeleted: false },
            select: { id: true, createdAt: true, retentionValue: true, retentionUnit: true },
        });
        const expiredIds = candidates.filter(retentionExpired).map((document) => document.id);
        if (!expiredIds.length)
            return;
        yield prisma.document.updateMany({ where: { id: { in: expiredIds } }, data: { isDeleted: true, deletedAt: new Date() } });
    });
}
