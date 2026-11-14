const crypto = require('crypto');
const fs = require('fs');

const CODE_LIFETIME_MS = 10 * 60_000;
const RESEND_DELAY_MS = 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validSecret(mode, secret) {
  return (mode === 'pin' && typeof secret === 'string' && /^\d{6,}$/.test(secret))
    || (mode === 'password' && typeof secret === 'string' && secret.length >= 8 && secret.length <= 200);
}

function lockHash(secret, salt) {
  return crypto.scryptSync(secret, salt, 64).toString('hex');
}

function sameHash(actual, expected) {
  const left = Buffer.from(actual || '', 'hex');
  const right = Buffer.from(expected || '', 'hex');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createAccessLock({ file, sendRecoveryMail, mailConfigured = false, now = Date.now }) {
  let pending = null;
  let lastSentAt = -Infinity;
  const codePepper = crypto.randomBytes(32);

  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return ['pin', 'password'].includes(value.mode) && typeof value.salt === 'string' && typeof value.hash === 'string' ? value : null;
    } catch { return null; }
  }

  function write(value) {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  function status() {
    const lock = read();
    return { configured: Boolean(lock), mode: lock?.mode ?? null, recoveryAvailable: Boolean(lock?.recoveryEmail && mailConfigured), mailConfigured };
  }

  function verify(secret) {
    const lock = read();
    if (!lock) return { ok: false };
    return { ok: typeof secret === 'string' && sameHash(lockHash(secret, lock.salt), lock.hash) };
  }

  function hashCode(code) { return crypto.createHmac('sha256', codePepper).update(code).digest('hex'); }

  async function sendCode(kind, email) {
    if (!mailConfigured) return { ok: false, error: 'Wysyłka e-mail nie jest skonfigurowana.' };
    if (lastSentAt + RESEND_DELAY_MS > now()) return { ok: false, error: 'Odczekaj minutę przed kolejną próbą.' };
    const code = crypto.randomInt(10_000_000, 100_000_000).toString();
    try { await sendRecoveryMail(email, code, kind); }
    catch { return { ok: false, error: 'Nie udało się wysłać kodu. Sprawdź ustawienia poczty.' }; }
    pending = { kind, email, hash: hashCode(code), expiresAt: now() + CODE_LIFETIME_MS, sentAt: now(), attempts: 0 };
    lastSentAt = now();
    return { ok: true };
  }

  async function requestEnrollment(email, authorized) {
    const lock = read();
    if (lock && !authorized) return { ok: false, error: 'Najpierw potwierdź obecny PIN lub hasło.' };
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalized.length > 255 || !EMAIL_PATTERN.test(normalized)) return { ok: false, error: 'Podaj prawidłowy adres e-mail.' };
    return sendCode('enroll', normalized);
  }

  async function requestReset() {
    const lock = read();
    if (!lock?.recoveryEmail) return { ok: false, error: 'Dla tej blokady nie zapisano adresu odzyskiwania.' };
    return sendCode('reset', lock.recoveryEmail);
  }

  function completeEnrollment(email, code, authorized) {
    const lock = read();
    if (!lock || !authorized) return { ok: false, error: 'Najpierw potwierdź obecny PIN lub hasło.' };
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!useCode('enroll', code, normalized)) return { ok: false, error: 'Nieprawidłowy lub wygasły kod potwierdzający e-mail.' };
    write({ ...lock, recoveryEmail: normalized });
    return { ok: true };
  }

  function useCode(kind, code, email) {
    if (!pending || pending.kind !== kind || pending.email !== email || now() > pending.expiresAt) return false;
    pending.attempts++;
    if (pending.attempts > 5) { pending = null; return false; }
    if (typeof code !== 'string' || !/^\d{8}$/.test(code) || !sameHash(hashCode(code), pending.hash)) return false;
    pending = null;
    return true;
  }

  function configure({ mode, secret, recoveryEmail, recoveryCode }, authorized) {
    const previous = read();
    if (previous && !authorized) return { ok: false, error: 'Najpierw potwierdź obecny PIN lub hasło.' };
    if (!validSecret(mode, secret)) return { ok: false, error: mode === 'pin' ? 'PIN musi mieć co najmniej 6 cyfr.' : 'Hasło musi mieć od 8 do 200 znaków.' };
    let email = previous?.recoveryEmail || null;
    if (recoveryEmail) {
      const normalized = String(recoveryEmail).trim().toLowerCase();
      if (!useCode('enroll', recoveryCode, normalized)) return { ok: false, error: 'Nieprawidłowy lub wygasły kod potwierdzający e-mail.' };
      email = normalized;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    write({ mode, salt, hash: lockHash(secret, salt), ...(email ? { recoveryEmail: email } : {}) });
    return { ok: true, mode };
  }

  function completeReset({ code, mode, secret }) {
    const previous = read();
    if (!previous?.recoveryEmail) return { ok: false, error: 'Brak adresu odzyskiwania.' };
    if (!validSecret(mode, secret)) return { ok: false, error: 'Nowy PIN lub hasło nie spełnia wymagań.' };
    if (!useCode('reset', code, previous.recoveryEmail)) return { ok: false, error: 'Nieprawidłowy lub wygasły kod.' };
    const salt = crypto.randomBytes(16).toString('hex');
    write({ mode, salt, hash: lockHash(secret, salt), recoveryEmail: previous.recoveryEmail });
    return { ok: true, mode };
  }

  return { status, verify, configure, requestEnrollment, completeEnrollment, requestReset, completeReset };
}

module.exports = { createAccessLock };
