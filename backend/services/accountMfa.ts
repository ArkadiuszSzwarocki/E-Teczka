import path from 'node:path';
import { securityDir } from '../config/paths';
import { createBackupMfaStore } from './backupMfaStore';
export const accountMfa = createBackupMfaStore(path.join(securityDir, 'account-login-mfa.enc'));
export class AccountMfaRequired extends Error {
 readonly code = 'MFA_REQUIRED';
 constructor() { super('Podaj kod z Microsoft Authenticator lub jednorazowy kod odzyskiwania.'); }
}
export function verifyAccountMfa(userId: number, code: unknown) {
 const owner = `login:user:${userId}`;
 if (accountMfa.enabled(owner) && (typeof code !== 'string' || !accountMfa.verify(owner, code.trim()))) throw new AccountMfaRequired();
}
