import { profileKey, profileOperation } from './mobileProfile';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { isRetentionUnit, type RetentionUnit } from '../types/domain';

const DRAFT_KEY = 'mojateczka.scan-draft.v1';

export type ScanDraft = {
  folderId: number;
  uploadId?: string;
  pages: string[];
  title: string;
  retentionValue: string;
  retentionUnit: RetentionUnit;
  retentionEnabled?: boolean;
};

async function saveScanDraftImpl(draft: ScanDraft) {
  await SecureStore.setItemAsync(profileKey(DRAFT_KEY), JSON.stringify(draft));
}

async function loadScanDraftImpl(folderId: number | null): Promise<ScanDraft | null> {
  if (!folderId) return null;
  const stored = await SecureStore.getItemAsync(profileKey(DRAFT_KEY));
  if (!stored) return null;
  try {
    const draft: unknown = JSON.parse(stored);
    if (!draft || typeof draft !== 'object') return null;
    const candidate = draft as Partial<ScanDraft>;
    if (candidate.folderId !== folderId || !Array.isArray(candidate.pages) || typeof candidate.title !== 'string'
      || typeof candidate.retentionValue !== 'string' || !isRetentionUnit(candidate.retentionUnit)) return null;
    const validDraft: ScanDraft = {
      folderId: candidate.folderId,
      uploadId: typeof candidate.uploadId === 'string' ? candidate.uploadId : undefined,
      pages: candidate.pages.filter((page): page is string => typeof page === 'string'),
      title: candidate.title,
      retentionValue: candidate.retentionValue,
      retentionUnit: candidate.retentionUnit,
      retentionEnabled: Boolean(candidate.retentionEnabled),
    };
    const pages = (await Promise.all(validDraft.pages.map(async (uri) => (await FileSystem.getInfoAsync(uri)).exists ? uri : null))).filter((uri): uri is string => Boolean(uri));
    return pages.length ? { ...validDraft, pages } : null;
  } catch {
    await clearScanDraft();
    return null;
  }
}

async function clearScanDraftImpl() {
  await SecureStore.deleteItemAsync(profileKey(DRAFT_KEY));
}

export const saveScanDraft = profileOperation(saveScanDraftImpl);
export const loadScanDraft = profileOperation(loadScanDraftImpl);
export const clearScanDraft = profileOperation(clearScanDraftImpl);
