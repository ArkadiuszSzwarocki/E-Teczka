import fs from 'node:fs';
import path from 'node:path';
import { securityDir } from '../config/paths';
import { encrypt, decrypt } from './backupCrypto';

export type LearnedSignature = {
  key: string;
  weight: number;
  label: string;
};

export type LearnedBoost = {
  boost: number;
  reason: string;
};

type LearningEntry = {
  folderId: number;
  hits: number;
  updatedAt: number;
};

type LearningStoreData = Record<string, Record<string, LearningEntry>>;

const LEARNING_FILE = path.join(securityDir, 'folder-learning.enc');
const MAX_SIGNATURES_PER_USER = 500;

function readStore(): LearningStoreData {
  try {
    const raw = fs.readFileSync(LEARNING_FILE, 'utf8');
    const parsed = JSON.parse(decrypt(raw)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as LearningStoreData) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

function writeStore(data: LearningStoreData): void {
  fs.mkdirSync(path.dirname(LEARNING_FILE), { recursive: true });
  const tmp = `${LEARNING_FILE}.tmp`;
  fs.writeFileSync(tmp, encrypt(JSON.stringify(data)), { mode: 0o600 });
  fs.renameSync(tmp, LEARNING_FILE);
}

/** Extracts stable, privacy-safe document signatures (NIP, vendor header) for offline folder learning. */
export function extractDocumentSignatures(ocrText: string): LearnedSignature[] {
  const signatures: LearnedSignature[] = [];
  const text = (ocrText || '').normalize('NFKC');

  const nipMatches = text.matchAll(/\b(?:nip|vat\s*id)[:\s-]*((?:\d[\s-]?){10})\b/gi);
  for (const match of nipMatches) {
    const digits = match[1].replace(/\D/g, '');
    if (digits.length === 10) {
      signatures.push({ key: `nip:${digits}`, weight: 25, label: `zapamiętany NIP ${digits}` });
      break;
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim().toLocaleLowerCase('pl').replace(/\s+/g, ' '))
    .filter(l => l.length >= 4 && !/^\d+([.,/-]\d+)*$/.test(l));

  if (lines.length > 0) {
    const header = lines[0].replace(/[^\p{L}\p{N}\s.-]/gu, '').trim().slice(0, 48);
    if (header.length >= 4) {
      signatures.push({ key: `hdr:${header}`, weight: 15, label: 'zapamiętany nadawca dokumentu' });
    }
  }

  return signatures;
}

/** Persists the user's chosen folder for extracted document signatures (encrypted per owner). */
export function recordFolderChoice(ownerId: number, ocrText: string, folderId: number): number {
  const signatures = extractDocumentSignatures(ocrText);
  if (signatures.length === 0) return 0;

  const store = readStore();
  const userKey = `user:${ownerId}`;
  const userMap = store[userKey] || {};
  const now = Date.now();

  for (const sig of signatures) {
    const existing = userMap[sig.key];
    userMap[sig.key] = {
      folderId,
      hits: existing && existing.folderId === folderId ? Math.min(existing.hits + 1, 50) : 1,
      updatedAt: now,
    };
  }

  const entries = Object.entries(userMap);
  if (entries.length > MAX_SIGNATURES_PER_USER) {
    entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    store[userKey] = Object.fromEntries(entries.slice(0, MAX_SIGNATURES_PER_USER));
  } else {
    store[userKey] = userMap;
  }

  writeStore(store);
  return signatures.length;
}

/** Returns per-folder score boosts learned from the user's previous manual folder corrections. */
export function getLearnedFolderBoosts(ownerId: number, ocrText: string): Map<number, LearnedBoost> {
  const boosts = new Map<number, LearnedBoost>();
  const signatures = extractDocumentSignatures(ocrText);
  if (signatures.length === 0) return boosts;

  const userMap = readStore()[`user:${ownerId}`];
  if (!userMap) return boosts;

  for (const sig of signatures) {
    const entry = userMap[sig.key];
    if (!entry) continue;
    const bonus = sig.weight + Math.min(entry.hits - 1, 5) * 2;
    const prev = boosts.get(entry.folderId);
    if (!prev || bonus > prev.boost) {
      boosts.set(entry.folderId, { boost: bonus, reason: sig.label });
    }
  }

  return boosts;
}

/** Exports learned folder signatures for password-free system settings backup. */
export function exportFolderLearning(ownerId: number): Record<string, LearningEntry> {
  return { ...(readStore()[`user:${ownerId}`] || {}) };
}

/** Merges learned folder signatures from a settings backup for the given owner. */
export function importFolderLearning(ownerId: number, entries: Record<string, LearningEntry>): number {
  const store = readStore();
  const userKey = `user:${ownerId}`;
  const current = { ...(store[userKey] || {}) };
  let imported = 0;

  for (const [sigKey, entry] of Object.entries(entries)) {
    if (!sigKey || !entry || !Number.isSafeInteger(entry.folderId) || entry.folderId < 1) continue;
    const prev = current[sigKey];
    if (!prev || entry.updatedAt > prev.updatedAt) {
      current[sigKey] = {
        folderId: entry.folderId,
        hits: Math.max(1, Math.min(Number(entry.hits) || 1, 50)),
        updatedAt: Number(entry.updatedAt) || Date.now(),
      };
      imported++;
    }
  }

  const allEntries = Object.entries(current);
  if (allEntries.length > MAX_SIGNATURES_PER_USER) {
    allEntries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    store[userKey] = Object.fromEntries(allEntries.slice(0, MAX_SIGNATURES_PER_USER));
  } else {
    store[userKey] = current;
  }

  writeStore(store);
  return imported;
}
