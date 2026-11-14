import crypto from 'crypto';
import { authSecret } from '../security/authSecret';

const key = crypto.createHash('sha256').update(authSecret()).digest();
const header = Buffer.from('ETECZKA-BACKUP-1\n');

export function encrypt(value: string) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function decrypt(value: string, decryptionKey: Buffer = key) {
  const [iv, tag, data] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
export function encryptBackup(data: Buffer) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), encrypted]);
}
export function exportRecoveryKey(passphrase: string): string {
  if (passphrase.length < 12) throw new Error('Hasło klucza odzyskiwania musi mieć co najmniej 12 znaków.');
  const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
  const wrappingKey = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
  const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
  return JSON.stringify({ type: 'eteczka-backup-recovery', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), key: encrypted.toString('base64') });
}
export function importRecoveryKey(contents: string, passphrase: string): Buffer {
  try {
    if (contents.length > 4096 || passphrase.length > 1024) throw new Error();
    const value = JSON.parse(contents) as { type?: string; version?: number; salt?: string; iv?: string; tag?: string; key?: string };
    if (value.type !== 'eteczka-backup-recovery' || value.version !== 1 || !value.salt || !value.iv || !value.tag || !value.key) throw new Error();
    const salt = Buffer.from(value.salt, 'base64'); const iv = Buffer.from(value.iv, 'base64'); const tag = Buffer.from(value.tag, 'base64'); const encrypted = Buffer.from(value.key, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || encrypted.length !== 32) throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch { throw new Error('Nieprawidłowy plik klucza odzyskiwania lub hasło.'); }
}
export function decryptBackup(data: Buffer, recoveryKey: Buffer = key) {
  if (!data.subarray(0, header.length).equals(header)) return data;
  const ivStart = header.length; const tagStart = ivStart + 12; const payloadStart = tagStart + 16;
  if (data.length <= payloadStart) throw new Error('Uszkodzona zaszyfrowana kopia.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', recoveryKey, data.subarray(ivStart, tagStart));
  decipher.setAuthTag(data.subarray(tagStart, payloadStart));
  return Buffer.concat([decipher.update(data.subarray(payloadStart)), decipher.final()]);
}
