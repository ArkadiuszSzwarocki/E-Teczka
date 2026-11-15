"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountMfaRequired = exports.accountMfa = void 0;
exports.verifyAccountMfa = verifyAccountMfa;
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
const backupMfaStore_1 = require("./backupMfaStore");
exports.accountMfa = (0, backupMfaStore_1.createBackupMfaStore)(node_path_1.default.join(paths_1.securityDir, 'account-login-mfa.enc'));
class AccountMfaRequired extends Error {
    constructor() {
        super('Podaj kod z Microsoft Authenticator lub jednorazowy kod odzyskiwania.');
        this.code = 'MFA_REQUIRED';
    }
}
exports.AccountMfaRequired = AccountMfaRequired;
function verifyAccountMfa(userId, code) {
    const owner = `login:user:${userId}`;
    if (exports.accountMfa.enabled(owner) && (typeof code !== 'string' || !exports.accountMfa.verify(owner, code.trim())))
        throw new AccountMfaRequired();
}
