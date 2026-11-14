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
exports.enqueuePremiumOcr = enqueuePremiumOcr;
const ocrPremium_1 = require("./ocrPremium");
function enqueuePremiumOcr(prisma, queue, res, documentId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!queue)
            return;
        try {
            if (!(yield (0, ocrPremium_1.hasOcrPremium)(prisma, res, true)))
                return;
            const ownerId = Number(res.locals.userId || 1);
            if (!(yield prisma.document.findFirst({ where: { id: documentId, folder: { ownerId } }, select: { id: true } })))
                return;
            queue.enqueue(documentId, (0, ocrPremium_1.ocrOwnerKey)(res));
        }
        catch (_a) {
            console.error('[ocr] Nie udało się dodać dokumentu do kolejki.');
        }
    });
}
