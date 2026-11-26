import { decrypt, encrypt } from './backupCrypto';

const prefix = 'mojateczka-ocr-v1:';
const legacyPrefix = 'eteczka-ocr-v1:';

/** New OCR text is encrypted at rest; pre-existing text remains readable for migration. */
export function protectOcrText(text: string): string { return prefix + encrypt(text); }
export function readOcrText(value: string | null | undefined, key?: Buffer): string {
  if (!value) return '';
  if (value.startsWith(prefix)) return decrypt(value.slice(prefix.length), key);
  if (value.startsWith(legacyPrefix)) return decrypt(value.slice(legacyPrefix.length), key);
  return value;
}

/** Safely reads OCR text, returning an empty string when a legacy record uses a rotated/unreadable key. */
export function safeReadOcrText(value: string | null | undefined, key?: Buffer): string {
  try {
    return readOcrText(value, key);
  } catch {
    return '';
  }
}
