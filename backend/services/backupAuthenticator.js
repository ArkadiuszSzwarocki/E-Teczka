"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBackupAuthenticator = createBackupAuthenticator;
exports.verifyBackupAuthenticator = verifyBackupAuthenticator;
exports.createBackupRecoveryCodes = createBackupRecoveryCodes;
exports.hashBackupRecoveryCode = hashBackupRecoveryCode;
exports.matchBackupRecoveryCode = matchBackupRecoveryCode;
const node_crypto_1 = __importDefault(require("node:crypto"));
const otplib_1 = require("otplib");
/** Cryptographic primitives only; callers must persist state atomically and rate-limit attempts. */
function createBackupAuthenticator(accountLabel) {
    const secret = (0, otplib_1.generateSecret)();
    return { secret, uri: (0, otplib_1.generateURI)({ issuer: 'E-Teczka', label: accountLabel, secret, algorithm: 'sha1', digits: 6, period: 30 }) };
}
/** Returns a time step for atomic replay protection, never a reusable authorization. */
function verifyBackupAuthenticator(secret, token, lastTimeStep) {
    if (!/^\d{6}$/.test(token))
        return null;
    try {
        const result = (0, otplib_1.verifySync)(Object.assign({ secret, token, algorithm: 'sha1', digits: 6, period: 30, epochTolerance: 30 }, (lastTimeStep === undefined ? {} : { afterTimeStep: lastTimeStep })));
        return result.valid && 'timeStep' in result ? result.timeStep : null;
    }
    catch (_a) {
        return null;
    }
}
function createBackupRecoveryCodes() {
    const codes = Array.from({ length: 10 }, () => node_crypto_1.default.randomBytes(12).toString('hex'));
    return { codes, hashes: codes.map(hashBackupRecoveryCode) };
}
function hashBackupRecoveryCode(code) {
    return node_crypto_1.default.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}
function matchBackupRecoveryCode(code, storedHashes) {
    if (!/^[a-f0-9]{24}$/i.test(code.trim()))
        return -1;
    const actual = Buffer.from(hashBackupRecoveryCode(code), 'hex');
    return storedHashes.findIndex(hash => { const expected = Buffer.from(hash, 'hex'); return expected.length === actual.length && node_crypto_1.default.timingSafeEqual(expected, actual); });
}
