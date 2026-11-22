import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { securityDir, uploadsDir } from '../config/paths';
import { encrypt, decrypt } from './backupCrypto';

export type MailAccountConfig = {
  id: string;
  label?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
};

export type MailInboxItem = {
  id: string;
  uid: number;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  subject: string;
  from: string;
  fromEmail?: string;
  receivedAt: string;
  suggestedFolderId: number | null;
  suggestedFolderName: string | null;
  detectedLabel: string;
  reason: string;
  extractedText: string;
};

type SyncCursor = {
  uidValidity: number;
  lastUid: number;
  resumeSeq?: number;
  resumeLimit?: string;
  unreadResumeSeq?: number;
};

type MailFilterState = {
  excludedSenders: string[];
  knownSenders: string[];
  syncCursors?: Record<string, SyncCursor>;
  processedKeys?: string[];
  senderFolderRules?: Record<string, number>;
};

const CONFIG_FILE = path.join(securityDir, 'mail-accounts.enc');
const FILTERS_FILE = path.join(securityDir, 'mail-filters.enc');
const VALID_ID = /^[0-9a-f-]{36}$/i;

export function extractSenderEmail(rawFrom: string): string {
  const trimmed = (rawFrom || '').trim().toLowerCase();
  if (/^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return trimmed;
  const match = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : '';
}

export function isSenderExcluded(email: string, excludedList: string[]): boolean {
  if (!email || excludedList.length === 0) return false;
  const norm = email.toLowerCase();
  if (excludedList.includes(norm)) return true;
  const at = norm.indexOf('@');
  if (at >= 0) {
    const domainRule = norm.slice(at); // "@domain.com"
    if (excludedList.includes(domainRule)) return true;
  }
  return false;
}

function readAllFilters(): Record<string, MailFilterState> {
  try {
    const raw = fs.readFileSync(FILTERS_FILE, 'utf8');
    const parsed = JSON.parse(decrypt(raw)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, MailFilterState>) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

function atomicWriteEncrypted(targetFile: string, encryptedPayload: string): void {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const tmp = `${targetFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, encryptedPayload, { mode: 0o600 });
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(tmp, targetFile);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        lastError = error;
        if (code !== 'EPERM' && code !== 'EBUSY') throw error;
      }
    }
    throw lastError;
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
  }
}

function writeAllFilters(data: Record<string, MailFilterState>): void {
  atomicWriteEncrypted(FILTERS_FILE, encrypt(JSON.stringify(data)));
}

export function getMailFilters(ownerId: number): MailFilterState {
  const state = readAllFilters()[`user:${ownerId}`];
  return {
    excludedSenders: Array.isArray(state?.excludedSenders) ? state.excludedSenders : [],
    knownSenders: Array.isArray(state?.knownSenders) ? state.knownSenders : [],
    syncCursors: state?.syncCursors && typeof state.syncCursors === 'object' ? state.syncCursors : {},
    processedKeys: Array.isArray(state?.processedKeys) ? state.processedKeys : [],
    senderFolderRules: state?.senderFolderRules && typeof state.senderFolderRules === 'object' ? state.senderFolderRules : {},
  };
}

export function getSenderFolderRule(email: string, rules?: Record<string, number>): number | null {
  if (!email || !rules) return null;
  const norm = email.toLowerCase();
  if (typeof rules[norm] === 'number' && rules[norm] > 0) return rules[norm];
  const at = norm.indexOf('@');
  if (at >= 0) {
    const dom = norm.slice(at);
    if (typeof rules[dom] === 'number' && rules[dom] > 0) return rules[dom];
  }
  return null;
}

export function setSenderFolderRule(ownerId: number, email: string, folderId: number | null): MailFilterState {
  const normalized = extractSenderEmail(email);
  if (!normalized) throw new Error('Nieprawidłowy adres e-mail nadawcy.');
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const rules = { ...(current.senderFolderRules || {}) };
  if (folderId && Number.isSafeInteger(folderId) && folderId > 0) rules[normalized] = folderId;
  else delete rules[normalized];
  const next: MailFilterState = {
    ...current,
    knownSenders: Array.from(new Set([...current.knownSenders, normalized])).sort(),
    senderFolderRules: rules,
  };
  all[`user:${ownerId}`] = next;
  writeAllFilters(all);
  return next;
}

/** Merges mail filter state (exclusions, auto-folder rules, cursors, processed keys) from a settings backup. */
export function restoreMailFilters(ownerId: number, incoming: Partial<MailFilterState>): MailFilterState {
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const next: MailFilterState = {
    excludedSenders: Array.from(new Set([...current.excludedSenders, ...(incoming.excludedSenders || [])])).sort(),
    knownSenders: Array.from(new Set([...current.knownSenders, ...(incoming.knownSenders || [])])).sort(),
    syncCursors: { ...current.syncCursors, ...(incoming.syncCursors || {}) },
    processedKeys: Array.from(new Set([...(current.processedKeys || []), ...(incoming.processedKeys || [])])).slice(-20_000),
    senderFolderRules: { ...(current.senderFolderRules || {}), ...(incoming.senderFolderRules || {}) },
  };
  all[`user:${ownerId}`] = next;
  writeAllFilters(all);
  return next;
}

export function markProcessedAttachmentKeys(ownerId: number, keys: string[]): void {
  const clean = keys.map(k => k.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return;
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const merged = Array.from(new Set([...(current.processedKeys || []), ...clean]));
  all[`user:${ownerId}`] = {
    ...current,
    processedKeys: merged.length > 20_000 ? merged.slice(merged.length - 20_000) : merged,
  };
  writeAllFilters(all);
}

export function getAccountSyncCursor(ownerId: number, accountId: string): SyncCursor | null {
  return getMailFilters(ownerId).syncCursors?.[accountId] || null;
}

export function saveAccountSyncCursor(
  ownerId: number,
  accountId: string,
  uidValidity: number,
  lastUid: number,
  resume?: { resumeSeq?: number; resumeLimit?: string; unreadResumeSeq?: number | null },
): void {
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const prev = current.syncCursors?.[accountId];
  const nextUnreadResume = resume && 'unreadResumeSeq' in resume
    ? (resume.unreadResumeSeq ?? undefined)
    : prev?.unreadResumeSeq;
  all[`user:${ownerId}`] = {
    ...current,
    syncCursors: {
      ...(current.syncCursors || {}),
      [accountId]: {
        uidValidity,
        lastUid,
        ...(resume?.resumeSeq ? { resumeSeq: resume.resumeSeq, resumeLimit: resume.resumeLimit } : {}),
        ...(nextUnreadResume ? { unreadResumeSeq: nextUnreadResume } : {}),
      },
    },
  };
  writeAllFilters(all);
}

export function clearAccountSyncCursors(ownerId: number, accountId?: string): void {
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const nextCursors = { ...(current.syncCursors || {}) };
  if (accountId) delete nextCursors[accountId];
  else for (const key of Object.keys(nextCursors)) delete nextCursors[key];
  all[`user:${ownerId}`] = {
    ...current,
    syncCursors: nextCursors,
  };
  writeAllFilters(all);
}

export function addKnownSenders(ownerId: number, emails: string[]): void {
  const clean = emails.map(e => extractSenderEmail(e)).filter(Boolean);
  if (clean.length === 0) return;
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const merged = Array.from(new Set([...current.knownSenders, ...clean])).slice(0, 500);
  all[`user:${ownerId}`] = { ...current, excludedSenders: current.excludedSenders, knownSenders: merged };
  writeAllFilters(all);
}

export function setSenderExcluded(ownerId: number, email: string, excluded: boolean): MailFilterState {
  const normalized = extractSenderEmail(email);
  if (!normalized) throw new Error('Nieprawidłowy adres e-mail nadawcy.');
  const all = readAllFilters();
  const current = getMailFilters(ownerId);
  const excludedSet = new Set(current.excludedSenders);
  const knownSet = new Set([...current.knownSenders, normalized]);
  if (excluded) excludedSet.add(normalized);
  else excludedSet.delete(normalized);
  const next: MailFilterState = {
    ...current,
    excludedSenders: Array.from(excludedSet).sort(),
    knownSenders: Array.from(knownSet).sort(),
  };
  all[`user:${ownerId}`] = next;
  writeAllFilters(all);
  return next;
}

function readAllConfigs(): Record<string, MailAccountConfig[]> {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(decrypt(raw)) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, MailAccountConfig[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[k] = v as MailAccountConfig[];
      } else if (v && typeof v === 'object') {
        const legacy = v as Omit<MailAccountConfig, 'id'>;
        out[k] = [{ id: 'default', ...legacy }];
      }
    }
    return out;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

function writeAllConfigs(data: Record<string, MailAccountConfig[]>): void {
  atomicWriteEncrypted(CONFIG_FILE, encrypt(JSON.stringify(data)));
}

export function getMailAccounts(ownerId: number): MailAccountConfig[] {
  return readAllConfigs()[`user:${ownerId}`] || [];
}

export function getPublicMailAccounts(ownerId: number) {
  return getMailAccounts(ownerId).map(cfg => ({
    id: cfg.id,
    label: cfg.label || cfg.user,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    mailbox: cfg.mailbox,
  }));
}

export function upsertMailAccount(ownerId: number, config: MailAccountConfig): MailAccountConfig[] {
  const all = readAllConfigs();
  const list = all[`user:${ownerId}`] || [];
  const idx = list.findIndex(a => a.id === config.id);
  if (idx >= 0) list[idx] = config;
  else list.push(config);
  all[`user:${ownerId}`] = list;
  writeAllConfigs(all);
  return list;
}

export function deleteMailAccount(ownerId: number, accountId: string): boolean {
  const all = readAllConfigs();
  const list = all[`user:${ownerId}`] || [];
  const next = list.filter(a => a.id !== accountId);
  if (next.length === list.length) return false;
  all[`user:${ownerId}`] = next;
  writeAllConfigs(all);
  return true;
}

export function getMailConfig(ownerId: number): MailAccountConfig | null {
  return getMailAccounts(ownerId)[0] || null;
}

export function getPublicMailConfig(ownerId: number) {
  const cfg = getMailConfig(ownerId);
  if (!cfg) return { configured: false, host: '', port: 993, secure: true, user: '', mailbox: 'INBOX' };
  return { configured: true, host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, mailbox: cfg.mailbox };
}

export function saveMailConfig(ownerId: number, config: Omit<MailAccountConfig, 'id'> & { id?: string }): void {
  upsertMailAccount(ownerId, { id: config.id || 'default', ...config });
}

export function mailInboxDir(ownerId: number): string {
  const dir = path.join(uploadsDir, '.mail-inbox', String(ownerId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listMailItems(ownerId: number): MailInboxItem[] {
  const dir = mailInboxDir(ownerId);
  const items: MailInboxItem[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as MailInboxItem;
      if (VALID_ID.test(parsed.id) && fs.existsSync(path.join(dir, parsed.storedName))) {
        items.push(parsed);
      }
    } catch { /* ignore malformed metadata */ }
  }
  return items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function saveMailItem(ownerId: number, item: MailInboxItem, content: Buffer): void {
  const dir = mailInboxDir(ownerId);
  fs.writeFileSync(path.join(dir, item.storedName), content, { flag: 'wx' });
  try {
    fs.writeFileSync(path.join(dir, `${item.id}.json`), JSON.stringify(item), { flag: 'wx' });
  } catch (err) {
    try { fs.unlinkSync(path.join(dir, item.storedName)); } catch { /* ignore */ }
    throw err;
  }
}

export function readMailItem(ownerId: number, id: string): MailInboxItem | null {
  if (!VALID_ID.test(id)) return null;
  const metaPath = path.join(mailInboxDir(ownerId), `${id}.json`);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8')) as MailInboxItem;
  } catch {
    return null;
  }
}

export function deleteMailItem(ownerId: number, id: string): boolean {
  const item = readMailItem(ownerId, id);
  if (!item) return false;
  const dir = mailInboxDir(ownerId);
  try { fs.unlinkSync(path.join(dir, item.storedName)); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(dir, `${item.id}.json`)); } catch { /* ignore */ }
  return true;
}
