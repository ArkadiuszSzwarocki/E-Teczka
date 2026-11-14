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
exports.ocrOwnerKey = ocrOwnerKey;
exports.hasOcrPremium = hasOcrPremium;
const premium_1 = require("../middleware/premium");
const planLedger_1 = require("./planLedger");
/** Paired devices access the desktop-local owner's documents. */
function ocrOwnerKey(res) {
    const key = (0, premium_1.billingOwnerKey)(res);
    return key.startsWith('device:') && !res.locals.userId ? 'desktop-local' : key;
}
function hasOcrPremium(prisma_1, res_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, res, startTrial = false) {
        return (yield (0, planLedger_1.featureTrial)(prisma, ocrOwnerKey(res), 'ocr', startTrial)).allowed;
    });
}
