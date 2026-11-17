import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './backupCrypto';
import { createBackupAuthenticator, createBackupRecoveryCodes, matchBackupRecoveryCode, verifyBackupAuthenticator } from './backupAuthenticator';

type RecordData = { secret: string; hashes: string[]; lastStep: number; failures: number; blockedUntil: number };
type Pending = { secret: string; expires: number; failures: number };
export class MfaSetupError extends Error {
  constructor(readonly code: 'MFA_SETUP_EXPIRED' | 'MFA_INVALID_CODE' | 'MFA_ALREADY_ENABLED', message: string) { super(message); }
}

export function createBackupMfaStore(filename: string, now: () => number = Date.now) {
  const pending = new Map<string, Pending>();
  function load(): Record<string, RecordData> {
    let text: string;
    try { text = fs.readFileSync(filename, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw e; }
    const parsed = JSON.parse(decrypt(text));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Nie można odczytać zabezpieczeń kopii.');
    return parsed;
  }
  function save(data: Record<string, RecordData>) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temp = `${filename}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp, encrypt(JSON.stringify(data)), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); fs.renameSync(temp, filename); }
    finally { try { fs.unlinkSync(temp); } catch { /* already renamed */ } }
  }
  function enabled(owner: string) { return Boolean(load()[owner]); }
  function start(owner: string) {
    if (enabled(owner)) throw new Error('Authenticator jest już włączony.');
    const generated = createBackupAuthenticator(owner); pending.set(owner, { secret: generated.secret, expires: now() + 5 * 60_000, failures: 0 });
    return { ...generated, expiresAt: now() + 5 * 60_000 };
  }
  function confirm(owner: string, code: string) {
    const proposal = pending.get(owner);
    if (!proposal || proposal.expires <= now()) { pending.delete(owner); throw new MfaSetupError('MFA_SETUP_EXPIRED', 'Konfiguracja wygasła. Rozpocznij ją ponownie i zeskanuj nowy kod QR.'); }
    const step = verifyBackupAuthenticator(proposal.secret, code.replace(/\s/g, ''));
    if (step === null) { proposal.failures++; if (proposal.failures >= 5) { pending.delete(owner); throw new MfaSetupError('MFA_SETUP_EXPIRED', 'Po kilku błędnych próbach konfiguracja została zamknięta. Zeskanuj nowy kod QR.'); } throw new MfaSetupError('MFA_INVALID_CODE', 'Kod nie pasuje do bieżącego kodu QR. Użyj najnowszego wpisu E‑Teczki w Authenticatorze i sprawdź automatyczny czas telefonu.'); }
    const data = load(); if (data[owner]) throw new MfaSetupError('MFA_ALREADY_ENABLED', 'Authenticator jest już włączony.');
    const recovery = createBackupRecoveryCodes();
    data[owner] = { secret: proposal.secret, hashes: recovery.hashes, lastStep: step, failures: 0, blockedUntil: 0 };
    save(data); pending.delete(owner); return recovery.codes;
  }
  function verify(owner: string, code: string): boolean {
    const data = load(); const record = data[owner]; if (!record) return false;
    if (record.blockedUntil > now()) return false;
    const step = verifyBackupAuthenticator(record.secret, code, record.lastStep);
    const index = step === null ? matchBackupRecoveryCode(code, record.hashes) : -1;
    if (step === null && index < 0) { record.failures++; if (record.failures >= 5) { record.blockedUntil = now() + 5 * 60_000; record.failures = 0; } save(data); return false; }
    if (step !== null) record.lastStep = step; else record.hashes.splice(index, 1);
    record.failures = 0; record.blockedUntil = 0; save(data); return true;
  }
  function remove(owner: string) { const data = load(); if (!data[owner]) throw new Error('Authenticator nie jest włączony.'); delete data[owner]; save(data); pending.delete(owner); }
  return { enabled, start, confirm, verify, remove };
}
