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
exports.CURRENT_TESTER_POLICY_VERSION = void 0;
exports.ensureTesterConsentSchema = ensureTesterConsentSchema;
exports.isTesterConsentRequired = isTesterConsentRequired;
exports.getTesterConsent = getTesterConsent;
exports.saveTesterConsent = saveTesterConsent;
exports.CURRENT_TESTER_POLICY_VERSION = '2026-11-17-disk';
let schemaReady = null;
/** Ensures the TesterConsent table exists in SQLite. */
function ensureTesterConsentSchema(prisma) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!schemaReady) {
            schemaReady = (() => __awaiter(this, void 0, void 0, function* () {
                yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS TesterConsent (userId INTEGER PRIMARY KEY, email TEXT NOT NULL, accepted INTEGER NOT NULL, storageMode TEXT NOT NULL, policyVersion TEXT NOT NULL, acceptedAt TEXT NOT NULL)');
            }))();
        }
        yield schemaReady;
    });
}
function isTesterConsentRequired() {
    return process.env.ETECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
}
/** Reads stored tester consent for a user from the QNAP/server database. */
function getTesterConsent(prisma, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureTesterConsentSchema(prisma);
        const rows = yield prisma.$queryRaw `
    SELECT userId, email, accepted, storageMode, policyVersion, acceptedAt
    FROM TesterConsent
    WHERE userId = ${userId}
    LIMIT 1
  `;
        const row = rows[0];
        const consent = row
            ? {
                userId: Number(row.userId),
                email: row.email,
                accepted: Boolean(row.accepted),
                storageMode: row.storageMode === 'qnap_server'
                    ? 'qnap_server'
                    : row.storageMode === 'local_browser'
                        ? 'local_browser'
                        : 'local_disk',
                policyVersion: row.policyVersion,
                acceptedAt: row.acceptedAt,
            }
            : null;
        const required = isTesterConsentRequired();
        const needsConsent = required && (!consent
            || !consent.accepted
            || consent.storageMode === 'local_browser'
            || consent.policyVersion !== exports.CURRENT_TESTER_POLICY_VERSION);
        return { required, needsConsent, consent };
    });
}
/** Records tester consent decision in the QNAP/server database. */
function saveTesterConsent(prisma, userId, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield ensureTesterConsentSchema(prisma);
        const user = yield prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        const email = (_a = user === null || user === void 0 ? void 0 : user.email) !== null && _a !== void 0 ? _a : `user-${userId}`;
        const acceptedInt = input.accepted ? 1 : 0;
        const acceptedAt = new Date().toISOString();
        yield prisma.$executeRaw `
    INSERT INTO TesterConsent(userId, email, accepted, storageMode, policyVersion, acceptedAt)
    VALUES (${userId}, ${email}, ${acceptedInt}, ${input.storageMode}, ${exports.CURRENT_TESTER_POLICY_VERSION}, ${acceptedAt})
    ON CONFLICT(userId) DO UPDATE SET
      email = excluded.email,
      accepted = excluded.accepted,
      storageMode = excluded.storageMode,
      policyVersion = excluded.policyVersion,
      acceptedAt = excluded.acceptedAt
  `;
        return {
            userId,
            email,
            accepted: input.accepted,
            storageMode: input.storageMode,
            policyVersion: exports.CURRENT_TESTER_POLICY_VERSION,
            acceptedAt,
        };
    });
}
