import * as FileSystem from 'expo-file-system/legacy';
import { getApiUrl, getAuthHeaders, getLocalConnection } from './localConnection';
import { profileDirectory } from './mobileProfile';
import { loadCachedDocuments, loadCachedFolders, saveCachedDocuments, saveCachedFolders } from './offlineCatalog';
import { uploadScanDocument } from './mobileScanUpload';
import type { RetentionDocument } from './retentionNotifications';
import type { RetentionUnit } from '../types/domain';
import type { FolderSummary } from '../types/navigation';

export type StandaloneQueuedScan = {
  localDocId: number;
  uploadId: string;
  folderId: number;
  folderName: string;
  title: string;
  pages: string[];
  retentionEnabled: boolean;
  retentionValue: string;
  retentionUnit: RetentionUnit;
  grayscale: boolean;
  createdAt: string;
};

const STANDALONE_ROOT = () => profileDirectory(`${FileSystem.documentDirectory || ''}mojateczka-standalone`);
const QUEUE_FILE = () => `${STANDALONE_ROOT()}/queue.json`;

const DEFAULT_STANDALONE_FOLDERS: FolderSummary[] = [
  { id: -100, name: 'Moje dokumenty (telefon)', parentId: null, order: 0 },
  { id: -101, name: 'Paragony', parentId: -100, order: 0 },
  { id: -102, name: 'Rachunki', parentId: -100, order: 1 },
  { id: -103, name: 'Gwarancje', parentId: -100, order: 2 },
  { id: -104, name: 'Dokumenty', parentId: -100, order: 3 },
];

async function readQueue(): Promise<StandaloneQueuedScan[]> {
  const info = await FileSystem.getInfoAsync(QUEUE_FILE());
  if (!info.exists) return [];
  try {
    const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(QUEUE_FILE()));
    return Array.isArray(parsed) ? (parsed as StandaloneQueuedScan[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: StandaloneQueuedScan[]): Promise<void> {
  await FileSystem.makeDirectoryAsync(STANDALONE_ROOT(), { intermediates: true });
  const tmp = `${QUEUE_FILE()}.${Date.now()}.tmp`;
  await FileSystem.writeAsStringAsync(tmp, JSON.stringify(items));
  await FileSystem.moveAsync({ from: tmp, to: QUEUE_FILE() });
}

/** Ensures a standalone user has local starter folders available immediately before pairing a PC. */
export async function ensureStandaloneFolders(): Promise<FolderSummary[]> {
  const cached = await loadCachedFolders().catch(() => [] as FolderSummary[]);
  if (cached.length > 0) return cached;
  await saveCachedFolders(DEFAULT_STANDALONE_FOLDERS);
  return DEFAULT_STANDALONE_FOLDERS;
}

/** Saves a scanned document directly to local phone storage for instant offline access and deferred PC sync. */
export async function saveStandaloneScan(input: {
  uploadId: string;
  folderId: number;
  title: string;
  pages: string[];
  retentionEnabled: boolean;
  retentionValue: string;
  retentionUnit: RetentionUnit;
  grayscale: boolean;
}): Promise<RetentionDocument> {
  const localDocId = -Math.floor(Date.now() % 2_000_000_000);
  const docDir = `${STANDALONE_ROOT()}/doc-${Math.abs(localDocId)}`;
  await FileSystem.makeDirectoryAsync(docDir, { intermediates: true });

  const persistedPages: string[] = [];
  for (let i = 0; i < input.pages.length; i++) {
    const ext = (input.pages[i].split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'jpg';
    const dest = `${docDir}/page-${i + 1}.${ext}`;
    await FileSystem.copyAsync({ from: input.pages[i], to: dest });
    persistedPages.push(dest);
  }

  const folders = await ensureStandaloneFolders();
  const targetFolder = folders.find(f => f.id === input.folderId);
  const nowIso = new Date().toISOString();
  const doc: RetentionDocument = {
    id: localDocId,
    title: input.title,
    filePath: persistedPages[0],
    mimeType: 'image/jpeg',
    folderId: input.folderId,
    createdAt: nowIso,
    updatedAt: nowIso,
    retentionEnabled: input.retentionEnabled,
    retentionValue: Number(input.retentionValue) || 5,
    retentionUnit: input.retentionUnit,
  };

  const existing = await loadCachedDocuments(input.folderId).catch(() => [] as RetentionDocument[]);
  await saveCachedDocuments(input.folderId, [doc, ...existing.filter(d => d.id !== localDocId)]);

  const queue = await readQueue();
  queue.push({
    localDocId,
    uploadId: input.uploadId,
    folderId: input.folderId,
    folderName: targetFolder?.name || 'Dokumenty',
    title: input.title,
    pages: persistedPages,
    retentionEnabled: input.retentionEnabled,
    retentionValue: input.retentionValue,
    retentionUnit: input.retentionUnit,
    grayscale: input.grayscale,
    createdAt: nowIso,
  });
  await writeQueue(queue);
  return doc;
}

/** Uploads deferred standalone scans to the paired desktop computer and clears synced local items. */
export async function syncStandaloneScans(): Promise<number> {
  const connection = await getLocalConnection();
  if (!connection) return 0;
  const queue = await readQueue();
  if (queue.length === 0) return 0;

  const headers = await getAuthHeaders();
  const foldersRes = await fetch(await getApiUrl('/api/folders'), { headers });
  if (!foldersRes.ok) return 0;
  const remoteFolders = (await foldersRes.json()) as FolderSummary[];
  const findOrCreateTargetFolder = async (folderId: number, folderName: string): Promise<number | null> => {
    if (folderId > 0 && remoteFolders.some(f => f.id === folderId)) return folderId;
    const byName = remoteFolders.find(f => f.parentId !== null && f.name.trim().toLowerCase() === folderName.trim().toLowerCase());
    if (byName) return byName.id;
    const anySubfolder = remoteFolders.find(f => f.parentId !== null);
    if (anySubfolder) return anySubfolder.id;
    let root = remoteFolders.find(f => f.parentId === null);
    if (!root) {
      const rootRes = await fetch(await getApiUrl('/api/folders'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Moje dokumenty', parentId: null }),
      });
      if (!rootRes.ok) return null;
      root = (await rootRes.json()) as FolderSummary;
      remoteFolders.push(root);
    }
    const subRes = await fetch(await getApiUrl('/api/folders'), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName || 'Skan z telefonu', parentId: root.id }),
    });
    if (!subRes.ok) return null;
    const sub = (await subRes.json()) as FolderSummary;
    remoteFolders.push(sub);
    return sub.id;
  };

  const remaining: StandaloneQueuedScan[] = [];
  let synced = 0;
  for (const item of queue) {
    try {
      const targetId = await findOrCreateTargetFolder(item.folderId, item.folderName);
      if (!targetId) {
        remaining.push(item);
        continue;
      }
      await uploadScanDocument({
        uploadId: item.uploadId,
        pages: item.pages,
        folderId: targetId,
        title: item.title,
        retentionEnabled: item.retentionEnabled,
        retentionValue: item.retentionValue,
        retentionUnit: item.retentionUnit,
        grayscale: item.grayscale,
        onStage: () => undefined,
      });
      synced++;
      const existing = await loadCachedDocuments(item.folderId).catch(() => [] as RetentionDocument[]);
      await saveCachedDocuments(item.folderId, existing.filter(d => d.id !== item.localDocId));
      await FileSystem.deleteAsync(`${STANDALONE_ROOT()}/doc-${Math.abs(item.localDocId)}`, { idempotent: true }).catch(() => undefined);
    } catch {
      remaining.push(item);
    }
  }
  await writeQueue(remaining);
  return synced;
}
