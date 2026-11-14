import crypto from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';

/** Cryptographic primitives only; callers must persist state atomically and rate-limit attempts. */
export function createBackupAuthenticator(accountLabel: string) {
  const secret = generateSecret();
  return { secret, uri: generateURI({ issuer: 'E-Teczka', label: accountLabel, secret, algorithm: 'sha1', digits: 6, period: 30 }) };
}

/** Returns a time step for atomic replay protection, never a reusable authorization. */
export function verifyBackupAuthenticator(secret: string, token: string, lastTimeStep?: number): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  try {
    const result = verifySync({ secret, token, algorithm: 'sha1', digits: 6, period: 30, epochTolerance: 30, ...(lastTimeStep === undefined ? {} : { afterTimeStep: lastTimeStep }) });
    return result.valid && 'timeStep' in result ? result.timeStep : null;
  } catch { return null; }
}

export function createBackupRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(12).toString('hex'));
  return { codes, hashes: codes.map(hashBackupRecoveryCode) };
}
export function hashBackupRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
}
export function matchBackupRecoveryCode(code: string, storedHashes: string[]): number {
  if (!/^[a-f0-9]{24}$/i.test(code.trim())) return -1;
  const actual = Buffer.from(hashBackupRecoveryCode(code), 'hex');
  return storedHashes.findIndex(hash => { const expected = Buffer.from(hash, 'hex'); return expected.length === actual.length && crypto.timingSafeEqual(expected, actual); });
}
