import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './backupCrypto';
import { createBackupAuthenticator, verifyBackupAuthenticator } from './backupAuthenticator';

export type VaultLoginMethod = 'pin_totp' | 'password_totp' | 'biometric_totp';

type VaultRecord = {
  passwordSalt: string;
  passwordHash: string;
  pinSalt: string;
  pinHash: string;
  totpSecret: string;
  lastStep: number;
  biometricEnabled: boolean;
  loginMethod: VaultLoginMethod;
  recoveryEmail: string;
  failures: number;
  blockedUntil: number;
};

type PendingSetup = { secret: string; expiresAt: number };
type PendingRecovery = { codeHash: string; expiresAt: number; attempts: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashSecret(secret: string, salt: string): string {
  return crypto.scryptSync(secret, salt, 64).toString('hex');
}

function sameHash(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateVaultSecrets(password: string, pin: string) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new Error('Nowe hasło do sejfu musi mieć od 8 do 200 znaków.');
  }
  if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) {
    throw new Error('Nowy kod PIN do sejfu musi składać się z 6–12 cyfr.');
  }
  if (password === pin) {
    throw new Error('Hasło i PIN do sejfu nie mogą być identyczne.');
  }
}

/** Encrypted per-folder vault store requiring Password + PIN + Authenticator + Biometrics. */
export function createFolderVaultStore(filename: string, now: () => number = Date.now) {
  const pendingSetups = new Map<string, PendingSetup>();
  const pendingRecoveries = new Map<string, PendingRecovery>();
  const pepper = crypto.randomBytes(32);

  function load(): Record<string, VaultRecord> {
    try {
      const raw = fs.readFileSync(filename, 'utf8');
      const parsed = JSON.parse(decrypt(raw));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }

  function save(data: Record<string, VaultRecord>) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temp = `${filename}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temp, encrypt(JSON.stringify(data)), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, filename);
    } finally {
      try { fs.unlinkSync(temp); } catch { /* already renamed */ }
    }
  }

  function status(key: string) {
    const rec = load()[key];
    if (!rec) return { configured: false, loginMethod: null, biometricEnabled: false, recoveryEmailConfigured: false };
    return {
      configured: true,
      loginMethod: rec.loginMethod,
      biometricEnabled: rec.biometricEnabled,
      recoveryEmailConfigured: Boolean(rec.recoveryEmail),
    };
  }

  function startSetup(key: string) {
    const generated = createBackupAuthenticator(`Sejf-${key}`);
    pendingSetups.set(key, { secret: generated.secret, expiresAt: now() + 10 * 60_000 });
    return { uri: generated.uri, secret: generated.secret };
  }

  function confirmSetup(
    key: string,
    input: { password: string; pin: string; totpCode: string; loginMethod: VaultLoginMethod; biometricEnabled: boolean; recoveryEmail: string },
  ) {
    const proposal = pendingSetups.get(key);
    if (!proposal || proposal.expiresAt <= now()) {
      pendingSetups.delete(key);
      throw new Error('Sesja konfiguracji sejfu wygasła. Zeskanuj kod QR ponownie.');
    }
    validateVaultSecrets(input.password, input.pin);
    if (!['pin_totp', 'password_totp', 'biometric_totp'].includes(input.loginMethod)) {
      throw new Error('Wybierz sposób logowania do sejfu.');
    }
    if (input.loginMethod === 'biometric_totp' && !input.biometricEnabled) {
      throw new Error('Zweryfikuj biometrię, aby wybrać logowanie biometrią.');
    }
    if (!EMAIL_RE.test(input.recoveryEmail.trim())) {
      throw new Error('Podaj prawidłowy adres e-mail do odzyskiwania.');
    }
    const step = verifyBackupAuthenticator(proposal.secret, input.totpCode.replace(/\s/g, ''));
    if (step === null) {
      throw new Error('Nieprawidłowy kod z Microsoft Authenticator.');
    }
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const pinSalt = crypto.randomBytes(16).toString('hex');
    const data = load();
    data[key] = {
      passwordSalt,
      passwordHash: hashSecret(input.password, passwordSalt),
      pinSalt,
      pinHash: hashSecret(input.pin, pinSalt),
      totpSecret: proposal.secret,
      lastStep: step,
      biometricEnabled: input.biometricEnabled,
      loginMethod: input.loginMethod,
      recoveryEmail: input.recoveryEmail.trim(),
      failures: 0,
      blockedUntil: 0,
    };
    save(data);
    pendingSetups.delete(key);
    return status(key);
  }

  function verifyTotpForRecord(data: Record<string, VaultRecord>, key: string, rec: VaultRecord, totpCode: string): boolean {
    if (rec.blockedUntil > now()) return false;
    const step = verifyBackupAuthenticator(rec.totpSecret, totpCode.replace(/\s/g, ''));
    if (step === null || step <= rec.lastStep) {
      rec.failures += 1;
      if (rec.failures >= 5) { rec.blockedUntil = now() + 5 * 60_000; rec.failures = 0; }
      data[key] = rec;
      save(data);
      return false;
    }
    rec.lastStep = step;
    rec.failures = 0;
    rec.blockedUntil = 0;
    data[key] = rec;
    save(data);
    return true;
  }

  function unlock(key: string, input: { secret?: string; biometricVerified?: boolean; totpCode: string }) {
    const data = load();
    const rec = data[key];
    if (!rec) throw new Error('Sejf nie został jeszcze skonfigurowany.');
    if (rec.blockedUntil > now()) throw new Error('Zbyt wiele prób. Odczekaj 5 minut.');
    if (!verifyTotpForRecord(data, key, rec, input.totpCode || '')) {
      throw new Error('Nieprawidłowy lub zużyty kod Authenticatora.');
    }
    if (rec.loginMethod === 'pin_totp') {
      if (!input.secret || !sameHash(hashSecret(input.secret, rec.pinSalt), rec.pinHash)) {
        throw new Error('Nieprawidłowy kod PIN do sejfu.');
      }
    } else if (rec.loginMethod === 'password_totp') {
      if (!input.secret || !sameHash(hashSecret(input.secret, rec.passwordSalt), rec.passwordHash)) {
        throw new Error('Nieprawidłowe hasło do sejfu.');
      }
    } else if (rec.loginMethod === 'biometric_totp') {
      if (!input.biometricVerified) {
        throw new Error('Wymagana weryfikacja biometryczna (Windows Hello).');
      }
    }
    return { ok: true };
  }

  async function requestRecovery(key: string, totpCode: string, sendMail: (email: string, code: string) => Promise<void>) {
    const data = load();
    const rec = data[key];
    if (!rec) throw new Error('Sejf nie został skonfigurowany.');
    if (!verifyTotpForRecord(data, key, rec, totpCode)) {
      throw new Error('Podaj aktualny kod z Microsoft Authenticator, aby wysłać kod na e-mail.');
    }
    const code = crypto.randomInt(10_000_000, 100_000_000).toString();
    await sendMail(rec.recoveryEmail, code);
    const codeHash = crypto.createHmac('sha256', pepper).update(code).digest('hex');
    pendingRecoveries.set(key, { codeHash, expiresAt: now() + 10 * 60_000, attempts: 0 });
    return { sentTo: rec.recoveryEmail.replace(/(^.).*(@.*$)/, '$1***$2') };
  }

  function completeRecovery(key: string, input: { emailCode: string; totpCode: string; newPassword: string; newPin: string }) {
    const pending = pendingRecoveries.get(key);
    if (!pending || pending.expiresAt <= now()) {
      pendingRecoveries.delete(key);
      throw new Error('Kod e-mail wygasł. Wyślij nowy kod po podaniu Authenticatora.');
    }
    const actualHash = crypto.createHmac('sha256', pepper).update(input.emailCode.trim()).digest('hex');
    if (!sameHash(actualHash, pending.codeHash)) {
      pending.attempts += 1;
      if (pending.attempts >= 5) pendingRecoveries.delete(key);
      throw new Error('Nieprawidłowy kod z wiadomości e-mail.');
    }
    const data = load();
    const rec = data[key];
    if (!rec) throw new Error('Sejf nie istnieje.');
    validateVaultSecrets(input.newPassword, input.newPin);
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const pinSalt = crypto.randomBytes(16).toString('hex');
    rec.passwordSalt = passwordSalt;
    rec.passwordHash = hashSecret(input.newPassword, passwordSalt);
    rec.pinSalt = pinSalt;
    rec.pinHash = hashSecret(input.newPin, pinSalt);
    rec.failures = 0;
    rec.blockedUntil = 0;
    data[key] = rec;
    save(data);
    pendingRecoveries.delete(key);
    return { ok: true };
  }

  return { status, startSetup, confirmSetup, unlock, requestRecovery, completeRecovery };
}
