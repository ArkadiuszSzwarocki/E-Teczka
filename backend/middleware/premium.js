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
exports.billingOwnerKey = billingOwnerKey;
exports.requirePremium = requirePremium;
exports.hasPremium = hasPremium;
function billingOwnerKey(response) {
    return String(response.locals.billingOwnerKey || 'desktop-local');
}
function requirePremium(prisma) {
    return (_request, response, next) => __awaiter(this, void 0, void 0, function* () {
        const subscription = yield prisma.subscription.findUnique({ where: { ownerKey: billingOwnerKey(response) } });
        const active = (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'active' || (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'trialing';
        if (active)
            return next();
        return response.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Ta funkcja wymaga aktywnego planu Premium.' });
    });
}
function hasPremium(prisma, response) {
    return __awaiter(this, void 0, void 0, function* () {
        const subscription = yield prisma.subscription.findUnique({ where: { ownerKey: billingOwnerKey(response) } });
        return (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'active' || (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'trialing';
    });
}
