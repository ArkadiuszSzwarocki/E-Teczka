import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/** Link and PIN are separate secrets; never store a raw public token or PIN. */
export function newShareToken(): string { return randomBytes(32).toString('base64url'); }
export function hashShareToken(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
export function newSharePin(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }
export function hashSharePin(pin: string): string {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN musi mieć sześć cyfr.');
  const salt = randomBytes(16); return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}
export function verifySharePin(pin: string, encoded: string): boolean {
  if (!/^\d{6}$/.test(pin) || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(encoded)) return false;
  const [salt, digest] = encoded.split(':'); const expected = Buffer.from(digest, 'hex');
  return timingSafeEqual(expected, scryptSync(pin, Buffer.from(salt, 'hex'), expected.length));
}
