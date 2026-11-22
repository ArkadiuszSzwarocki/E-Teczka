import { decrypt, encrypt } from './backupCrypto';

const prefix = 'mojateczka-ocr-v1:';

/** New OCR text is encrypted at rest; pre-existing text remains readable for migration. */
export function protectOcrText(text: string): string { return prefix + encrypt(text); }
export function readOcrText(value: string | null | undefined, key?: Buffer): string {
  if (!value) return '';
  return value.startsWith(prefix) ? decrypt(value.slice(prefix.length), key) : value;
}
