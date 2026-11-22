import { getRodoCategories, maskRodoText } from './rodoProtection';

const MASKING_KEY = 'mojateczka_sensitive_masking_v1';
const AUTO_SUGGEST_KEY = 'mojateczka_auto_suggest_folder_v1';
const ALLOW_SERVER_AI_KEY = 'mojateczka_allow_server_ai_v1';
const AUTO_MAIL_SYNC_KEY = 'mojateczka_auto_mail_sync_v1';

export const MASKING_CHANGED_EVENT = 'mojateczka-masking-changed';

export function getSensitiveMaskingEnabled(): boolean {
  try {
    return localStorage.getItem(MASKING_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSensitiveMaskingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(MASKING_KEY, enabled ? '1' : '0');
  } catch { /* ignore storage errors */ }
  window.dispatchEvent(new Event(MASKING_CHANGED_EVENT));
}

export function getAutoSuggestFolderEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SUGGEST_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoSuggestFolderEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SUGGEST_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(MASKING_CHANGED_EVENT));
}

export function getAllowServerAiEnabled(): boolean {
  try {
    return localStorage.getItem(ALLOW_SERVER_AI_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAllowServerAiEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ALLOW_SERVER_AI_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(MASKING_CHANGED_EVENT));
}

export function getAutoMailSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_MAIL_SYNC_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoMailSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_MAIL_SYNC_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
  window.dispatchEvent(new Event(MASKING_CHANGED_EVENT));
}

/** Masks detected RODO personal/sensitive fields in OCR text using [RODO: ...] tags. */
export function maskSensitiveText(text: string): string {
  return maskRodoText(text, getRodoCategories());
}
