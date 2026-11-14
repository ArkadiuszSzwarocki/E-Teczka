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
exports.withSyncReceipt = withSyncReceipt;
const crypto_1 = require("crypto");
/** Execute a synchronization operation once, even if its HTTP response is lost. */
function withSyncReceipt(prisma, ownerKey, operationId, payload, apply) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ownerKey || !operationId || operationId.length > 128)
            throw new Error('Nieprawidłowy identyfikator operacji synchronizacji.');
        const serialized = JSON.stringify(payload);
        if (serialized === undefined)
            throw new Error('Nieprawidłowe dane operacji synchronizacji.');
        const payloadHash = (0, crypto_1.createHash)('sha256').update(serialized).digest('hex');
        return prisma.$transaction((transaction) => __awaiter(this, void 0, void 0, function* () {
            const rows = yield transaction.$queryRaw `SELECT result FROM SyncOperation WHERE ownerKey = ${ownerKey} AND operationId = ${operationId}`;
            if (rows.length) {
                const stored = JSON.parse(rows[0].result);
                if (stored.payloadHash !== payloadHash)
                    throw new Error('Identyfikator synchronizacji został użyty dla innych danych.');
                return { value: stored.value, replayed: true };
            }
            const value = yield apply(transaction);
            const result = JSON.stringify({ payloadHash, value });
            yield transaction.$executeRaw `INSERT INTO SyncOperation (ownerKey, operationId, result) VALUES (${ownerKey}, ${operationId}, ${result})`;
            return { value, replayed: false };
        }));
    });
}
