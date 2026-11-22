import * as FileSystem from 'expo-file-system/legacy';
import { profileKey, profileOperation } from './mobileProfile';

export type MobileLearnedBoost = {
  boost: number;
  reason: string;
};

type LearnedSignature = {
  key: string;
  weight: number;
  label: string;
};

type LearningEntry = {
  folderId: number;
  hits: number;
  updatedAt: number;
};

type LearningMap = Record<string, LearningEntry>;

const MAX_SIGNATURES = 400;

function learningFileUri(): string {
  const safeName = profileKey('folder_learning_v1').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${FileSystem.documentDirectory || ''}${safeName}.json`;
}

async function readLearningMap(): Promise<LearningMap> {
  try {
    const uri = learningFileUri();
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return {};
    const raw = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as LearningMap) : {};
  } catch {
    return {};
  }
}

async function writeLearningMap(map: LearningMap): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(learningFileUri(), JSON.stringify(map));
  } catch {
    // Non-fatal: learning cache stays best-effort
  }
}

/** Extracts privacy-safe document signatures (NIP, header line) locally on the phone. */
export function extractMobileSignatures(ocrText: string): LearnedSignature[] {
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
      signatures.push({ key: `hdr:${header}`, weight: 15, label: 'zapamiętany nadawca' });
    }
  }

  return signatures;
}

/** Saves the user's folder correction locally on the mobile device for future offline scans. */
export const recordMobileFolderChoice = profileOperation(async (ocrText: string, folderId: number): Promise<number> => {
  const signatures = extractMobileSignatures(ocrText);
  if (signatures.length === 0) return 0;

  const map = await readLearningMap();
  const now = Date.now();
  for (const sig of signatures) {
    const existing = map[sig.key];
    map[sig.key] = {
      folderId,
      hits: existing && existing.folderId === folderId ? Math.min(existing.hits + 1, 50) : 1,
      updatedAt: now,
    };
  }

  const entries = Object.entries(map);
  const trimmed = entries.length > MAX_SIGNATURES
    ? Object.fromEntries(entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_SIGNATURES))
    : map;

  await writeLearningMap(trimmed);
  return signatures.length;
});

/** Computes per-folder score boosts from previous offline user corrections on this phone. */
export const getMobileLearnedBoosts = profileOperation(async (ocrText: string): Promise<Map<number, MobileLearnedBoost>> => {
  const boosts = new Map<number, MobileLearnedBoost>();
  const signatures = extractMobileSignatures(ocrText);
  if (signatures.length === 0) return boosts;

  const map = await readLearningMap();
  for (const sig of signatures) {
    const entry = map[sig.key];
    if (!entry) continue;
    const bonus = sig.weight + Math.min(entry.hits - 1, 5) * 2;
    const prev = boosts.get(entry.folderId);
    if (!prev || bonus > prev.boost) {
      boosts.set(entry.folderId, { boost: bonus, reason: sig.label });
    }
  }
  return boosts;
});
