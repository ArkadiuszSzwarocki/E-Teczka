type LocalFolder = {
  id: number;
  name: string;
  parentId: number | null;
  ownerId: number;
  order: number;
  createdAt: string;
  updatedAt: string;
};

type LocalTag = {
  id: number;
  name: string;
  color: string;
};

type LocalDocument = {
  id: number;
  title: string;
  filePath: string;
  mimeType: string;
  folderId: number;
  physicalLocation: string | null;
  retentionEnabled: boolean;
  retentionValue: number;
  retentionUnit: string;
  thumbnail: string | null;
  isArchived: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagIds: number[];
  merchantName: string | null;
  amountCents: number | null;
  currency: string;
  dueDate: string | null;
  paymentStatus: string | null;
};

type LocalDatabase = {
  nextFolderId: number;
  nextDocId: number;
  nextTagId: number;
  folders: LocalFolder[];
  documents: LocalDocument[];
  tags: LocalTag[];
  blobs: Record<string, { mimeType: string; dataUrl: string; size: number }>;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

const DB_NAME = 'eteczka_tester_local_db_v1';
const STORE_NAME = 'workspaces';
const HANDLE_STORE = 'handles';

function emptyDb(): LocalDatabase {
  return { nextFolderId: 1, nextDocId: 1, nextTagId: 1, folders: [], documents: [], tags: [], blobs: {} };
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      if (!req.result.objectStoreNames.contains(HANDLE_STORE)) req.result.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Nie udało się otworzyć lokalnego magazynu.'));
  });
}

async function getDiskHandle(key: string): Promise<FileSystemDirectoryHandle | null> {
  const idb = await openIdb();
  return new Promise(resolve => {
    const tx = idb.transaction(HANDLE_STORE, 'readonly');
    const req = tx.objectStore(HANDLE_STORE).get(key);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function saveDiskHandle(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const idb = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Nie udało się zapisać dostępu do folderu.'));
  });
}

async function verifyHandlePermission(handle: FileSystemDirectoryHandle, requestIfNeeded: boolean): Promise<boolean> {
  const perms = handle as FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  if (typeof perms.queryPermission === 'function') {
    const current = await perms.queryPermission({ mode: 'readwrite' });
    if (current === 'granted') return true;
    if (!requestIfNeeded) return false;
  }
  if (requestIfNeeded && typeof perms.requestPermission === 'function') {
    return (await perms.requestPermission({ mode: 'readwrite' })) === 'granted';
  }
  return true;
}

export function isDiskStorageSupported(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function getSelectedDiskFolderName(userEmail: string): Promise<string | null> {
  const handle = await getDiskHandle(`user:${userEmail.trim().toLowerCase()}`);
  return handle?.name ?? null;
}

export async function hasActiveDiskPermission(userEmail: string): Promise<{ hasHandle: boolean; granted: boolean; folderName: string | null }> {
  const handle = await getDiskHandle(`user:${userEmail.trim().toLowerCase()}`);
  if (!handle) return { hasHandle: false, granted: false, folderName: null };
  const granted = await verifyHandlePermission(handle, false);
  return { hasHandle: true, granted, folderName: handle.name };
}

export async function requestSavedDiskPermission(userEmail: string): Promise<boolean> {
  const handle = await getDiskHandle(`user:${userEmail.trim().toLowerCase()}`);
  if (!handle) return false;
  return verifyHandlePermission(handle, true);
}

/** Prompts the user to pick a local disk folder and initializes `eteczka-db.json` + `uploads/` inside it. */
export async function pickTesterDiskDirectory(userEmail: string): Promise<string> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Twoja przeglądarka nie obsługuje zapisu bezpośrednio do folderu na dysku. Użyj Chrome lub Edge na komputerze.');
  const handle = await picker({ id: 'eteczka-local-db', mode: 'readwrite' });
  const granted = await verifyHandlePermission(handle, true);
  if (!granted) throw new Error('Nie przyznano uprawnień zapisu do wybranego folderu.');

  const key = `user:${userEmail.trim().toLowerCase()}`;
  await saveDiskHandle(key, handle);
  await handle.getDirectoryHandle('uploads', { create: true });
  try {
    await handle.getFileHandle('eteczka-db.json', { create: false });
  } catch {
    const fileHandle = await handle.getFileHandle('eteczka-db.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(emptyDb(), null, 2));
    await writable.close();
  }
  return handle.name;
}

function dataUrlToBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)?;base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mimeType, bytes };
}

function bytesToDataUrl(bytes: ArrayBuffer, mimeType: string): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function readDb(key: string): Promise<LocalDatabase> {
  const diskHandle = await getDiskHandle(key);
  if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
    try {
      const fileHandle = await diskHandle.getFileHandle('eteczka-db.json', { create: false });
      const file = await fileHandle.getFile();
      const parsed = JSON.parse(await file.text()) as LocalDatabase;
      return { ...emptyDb(), ...parsed, blobs: parsed.blobs || {} };
    } catch {
      return emptyDb();
    }
  }
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as LocalDatabase | undefined) ?? emptyDb());
    req.onerror = () => reject(req.error || new Error('Błąd odczytu lokalnej bazy.'));
  });
}

async function writeDb(key: string, db: LocalDatabase, changedFiles?: Array<{ name: string; dataUrl: string }>, deletedFiles?: string[]): Promise<void> {
  const diskHandle = await getDiskHandle(key);
  if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
    const uploadsHandle = await diskHandle.getDirectoryHandle('uploads', { create: true });
    for (const item of changedFiles || []) {
      const parsed = dataUrlToBytes(item.dataUrl);
      if (!parsed) continue;
      const fh = await uploadsHandle.getFileHandle(item.name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(new Uint8Array(parsed.bytes).buffer);
      await writable.close();
    }
    for (const filename of deletedFiles || []) {
      try { await uploadsHandle.removeEntry(filename); } catch { /* ignore */ }
    }
    // Keep lightweight metadata on disk in eteczka-db.json while physical files live in uploads/.
    const compact: LocalDatabase = {
      ...db,
      blobs: Object.fromEntries(Object.entries(db.blobs).map(([k, v]) => [k, { mimeType: v.mimeType, dataUrl: '', size: v.size }])),
    };
    const dbFile = await diskHandle.getFileHandle('eteczka-db.json', { create: true });
    const writable = await dbFile.createWritable();
    await writable.write(JSON.stringify(compact, null, 2));
    await writable.close();
    return;
  }

  const idb = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(db, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Błąd zapisu lokalnej bazy.'));
  });
}

async function readBlobDataUrl(key: string, db: LocalDatabase, filename: string): Promise<{ mimeType: string; dataUrl: string } | null> {
  const meta = db.blobs[filename];
  if (meta?.dataUrl) return { mimeType: meta.mimeType, dataUrl: meta.dataUrl };
  const diskHandle = await getDiskHandle(key);
  if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
    try {
      const uploadsHandle = await diskHandle.getDirectoryHandle('uploads', { create: false });
      const fh = await uploadsHandle.getFileHandle(filename, { create: false });
      const file = await fh.getFile();
      const mimeType = meta?.mimeType || file.type || 'application/octet-stream';
      return { mimeType, dataUrl: bytesToDataUrl(await file.arrayBuffer(), mimeType) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Permanently deletes all local disk files (`eteczka-db.json` + `uploads/`) and IndexedDB state for the user. */
export async function clearLocalTesterWorkspace(userEmail: string): Promise<void> {
  const key = `user:${userEmail.trim().toLowerCase()}`;
  const diskHandle = await getDiskHandle(key);
  if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
    try { await diskHandle.removeEntry('uploads', { recursive: true }); } catch { /* ignore */ }
    try { await diskHandle.removeEntry('eteczka-db.json'); } catch { /* ignore */ }
  }
  const idb = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = idb.transaction([STORE_NAME, HANDLE_STORE], 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.objectStore(HANDLE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Nie udało się wyczyścić lokalnej bazy.'));
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function collectBranchIds(folders: LocalFolder[], rootId: number): number[] {
  const result = [rootId];
  for (let i = 0; i < result.length; i++) {
    const current = result[i];
    for (const f of folders) if (f.parentId === current && !result.includes(f.id)) result.push(f.id);
  }
  return result;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

function dataUrlToResponse(dataUrl: string, fallbackMime: string): Response {
  const parsed = dataUrlToBytes(dataUrl);
  if (!parsed) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(parsed.bytes).buffer, { status: 200, headers: { 'Content-Type': parsed.mimeType || fallbackMime } });
}

function buildLocalAnalytics(db: LocalDatabase, selectedMonth?: string) {
  const now = new Date();
  const targetMonth = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)
    ? selectedMonth
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const activeDocs = db.documents.filter(d => !d.isDeleted);
  const totalBytes = activeDocs.reduce((sum, d) => sum + (db.blobs[d.filePath]?.size || 0), 0);
  const monthLabels = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'];
  const monthlySeries = Array.from({ length: 6 }, (_, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const count = activeDocs.filter(doc => doc.createdAt.startsWith(key)).length;
    return { key, label: monthLabels[d.getMonth()], count, amountCents: 0 };
  });
  const byFolder = new Map<number, number>();
  for (const d of activeDocs) byFolder.set(d.folderId, (byFolder.get(d.folderId) || 0) + 1);
  const distribution = db.folders
    .filter(f => byFolder.has(f.id))
    .map(f => ({ folderId: f.id, name: f.name, count: byFolder.get(f.id) || 0 }));

  return {
    selectedMonth: targetMonth,
    monthlyCostsCents: 0,
    unpaidCostsCents: 0,
    currency: 'PLN',
    monthlySeries,
    distribution,
    totalDocuments: activeDocs.length,
    totalFolders: db.folders.length,
    storageBytes: totalBytes,
    upcomingDeadlines: [],
    receiptInsights: { totalCount: 0, totalCents: 0, topMerchants: [], categories: [], receipts: [] },
    vaultFoldersCount: db.folders.filter(f => f.name.trim().toLowerCase() === 'sejf').length,
    recentUploadsCount: activeDocs.filter(d => Date.now() - Date.parse(d.createdAt) <= 30 * 86_400_000).length,
  };
}

const LOCAL_TESTER_FETCH_FLAG = Symbol('isLocalTesterFetcher');

export function isLocalTesterFetcher(fetcher: typeof fetch): boolean {
  return Boolean((fetcher as typeof fetch & { [LOCAL_TESTER_FETCH_FLAG]?: boolean })?.[LOCAL_TESTER_FETCH_FLAG]);
}

/**
 * Creates a fetch wrapper backed by the user's chosen local disk directory (or IndexedDB fallback).
 * Auth, tester consent, billing, feedback, and plan endpoints still talk to the server.
 */
export function createLocalTesterFetcher(userEmail: string, networkFetch: typeof fetch): typeof fetch {
  const key = `user:${userEmail.trim().toLowerCase()}`;

  const localFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let pathname = rawUrl;
    let searchParams = new URLSearchParams();
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      pathname = parsed.pathname;
      searchParams = parsed.searchParams;
    } catch { /* keep pathname */ }

    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const parseBody = () => {
      if (typeof init?.body !== 'string') return {};
      try { return JSON.parse(init.body) as Record<string, any>; } catch { return {}; }
    };

    if (pathname.startsWith('/uploads/')) {
      const db = await readDb(key);
      const filename = decodeURIComponent(pathname.slice('/uploads/'.length));
      const blob = await readBlobDataUrl(key, db, filename);
      return blob ? dataUrlToResponse(blob.dataUrl, blob.mimeType) : new Response('Not found', { status: 404 });
    }

    if (pathname === '/api/folders' && method === 'GET') {
      const db = await readDb(key);
      return jsonResponse(db.folders.slice().sort((a, b) => a.order - b.order).map(f => ({
        ...f,
        _count: { documents: db.documents.filter(d => d.folderId === f.id && !d.isArchived && !d.isDeleted).length },
      })));
    }

    if (pathname === '/api/folders' && method === 'POST') {
      const db = await readDb(key);
      const body = parseBody();
      const now = new Date().toISOString();
      const folder: LocalFolder = {
        id: db.nextFolderId++,
        name: String(body.name || 'Nowa kartoteka').trim(),
        parentId: body.parentId ? Number(body.parentId) : null,
        ownerId: 1,
        order: db.folders.filter(f => f.parentId === (body.parentId ? Number(body.parentId) : null)).length,
        createdAt: now,
        updatedAt: now,
      };
      db.folders.push(folder);
      await writeDb(key, db);
      return jsonResponse(folder);
    }

    if (pathname === '/api/folders/reorder' && method === 'POST') {
      const db = await readDb(key);
      const ids = Array.isArray(parseBody().orderedIds) ? (parseBody().orderedIds as number[]).map(Number) : [];
      ids.forEach((id, idx) => { const f = db.folders.find(item => item.id === id); if (f) f.order = idx; });
      await writeDb(key, db);
      return jsonResponse({ success: true });
    }

    const folderMatch = /^\/api\/folders\/(\d+)(\/delete-preview|\/delete-safely|\/move)?$/.exec(pathname);
    if (folderMatch) {
      const folderId = Number(folderMatch[1]);
      const suffix = folderMatch[2] || '';
      const db = await readDb(key);
      const folder = db.folders.find(f => f.id === folderId);
      if (!folder) return jsonResponse({ error: 'Nie znaleziono kartoteki.' }, 404);

      if (!suffix && method === 'PATCH') {
        const body = parseBody();
        if (typeof body.name === 'string' && body.name.trim()) folder.name = body.name.trim();
        if (body.parentId !== undefined) folder.parentId = body.parentId === null ? null : Number(body.parentId);
        folder.updatedAt = new Date().toISOString();
        await writeDb(key, db);
        return jsonResponse(folder);
      }

      if (suffix === '/delete-preview' && method === 'GET') {
        const ids = collectBranchIds(db.folders, folderId);
        const docs = db.documents.filter(d => ids.includes(d.folderId));
        return jsonResponse({
          folderIds: ids,
          documentCount: docs.filter(d => !d.isDeleted && !d.isArchived).length,
          archivedCount: docs.filter(d => !d.isDeleted && d.isArchived).length,
          trashedCount: docs.filter(d => d.isDeleted).length,
        });
      }

      if (suffix === '/delete-safely' && method === 'POST') {
        const body = parseBody();
        const ids = collectBranchIds(db.folders, folderId);
        const targetId = body.transferFolderId ? Number(body.transferFolderId) : null;
        if (body.mode === 'trash') {
          const fallback = db.folders.find(f => !ids.includes(f.id));
          for (const d of db.documents) {
            if (ids.includes(d.folderId)) {
              if (!fallback) return jsonResponse({ error: 'Pozostaw przynajmniej jedną inną kartotekę.' }, 409);
              d.isDeleted = true; d.isArchived = false; d.deletedAt = new Date().toISOString(); d.folderId = fallback.id;
            }
          }
        } else if (targetId) {
          for (const d of db.documents) if (ids.includes(d.folderId)) d.folderId = targetId;
        }
        db.folders = db.folders.filter(f => !ids.includes(f.id));
        await writeDb(key, db);
        return jsonResponse({ success: true });
      }
    }

    if (pathname === '/api/documents' && method === 'GET') {
      const db = await readDb(key);
      const folderIdParam = searchParams.get('folderId');
      const filtered = folderIdParam
        ? db.documents.filter(d => d.folderId === Number(folderIdParam))
        : db.documents;
      return jsonResponse(filtered.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(doc => ({
        ...doc,
        fileSize: db.blobs[doc.filePath]?.size || 0,
        readOnly: false,
        tags: doc.tagIds.map(tid => {
          const tag = db.tags.find(t => t.id === tid);
          return tag ? { documentId: doc.id, tagId: tid, tag: { ...tag, inactive: false } } : null;
        }).filter(Boolean),
      })));
    }

    if (pathname === '/api/documents/upload-base64' && method === 'POST') {
      const db = await readDb(key);
      const body = parseBody();
      const files = Array.isArray(body.files) ? body.files as Array<{ name: string; data: string; thumbnail?: string | null }> : [];
      const retentions = Array.isArray(body.retentions) ? body.retentions as Array<{ enabled?: boolean; value?: number; unit?: string }> : [];
      const folderId = Number(body.folderId);
      const savedDocs: LocalDocument[] = [];
      const changedFiles: Array<{ name: string; dataUrl: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ret = retentions[i] || {};
        const match = /^data:([^;,]+);base64,/.exec(f.data || '');
        const mimeType = match?.[1] || 'application/octet-stream';
        const filePath = `local_${Date.now()}_${db.nextDocId}_${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const now = new Date().toISOString();
        db.blobs[filePath] = { mimeType, dataUrl: f.data, size: estimateDataUrlBytes(f.data) };
        changedFiles.push({ name: filePath, dataUrl: f.data });
        const doc: LocalDocument = {
          id: db.nextDocId++,
          title: f.name,
          filePath,
          mimeType,
          folderId,
          physicalLocation: body.physicalLocation || null,
          retentionEnabled: ret.enabled !== false,
          retentionValue: Number(ret.value) || 5,
          retentionUnit: String(ret.unit || 'years'),
          thumbnail: f.thumbnail || null,
          isArchived: false,
          isDeleted: false,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          tagIds: [],
          merchantName: null,
          amountCents: null,
          currency: 'PLN',
          dueDate: null,
          paymentStatus: null,
        };
        db.documents.push(doc);
        savedDocs.push(doc);
      }
      await writeDb(key, db, changedFiles);
      return jsonResponse({ success: true, savedDocs, skippedDuplicates: [] });
    }

    if (pathname === '/api/documents/empty-trash' && method === 'POST') {
      const db = await readDb(key);
      const toRemove = db.documents.filter(d => d.isDeleted);
      const deletedFiles: string[] = [];
      for (const d of toRemove) {
        delete db.blobs[d.filePath];
        deletedFiles.push(d.filePath);
      }
      db.documents = db.documents.filter(d => !d.isDeleted);
      await writeDb(key, db, undefined, deletedFiles);
      return jsonResponse({ deleted: toRemove.length, failedFiles: 0 });
    }

    const docMatch = /^\/api\/documents\/(\d+)(\/data-url)?$/.exec(pathname);
    if (docMatch) {
      const docId = Number(docMatch[1]);
      const isDataUrl = docMatch[2] === '/data-url';
      const db = await readDb(key);
      const doc = db.documents.find(d => d.id === docId);
      if (!doc) return jsonResponse({ error: 'Nie znaleziono dokumentu.' }, 404);
      if (isDataUrl && method === 'GET') {
        const blob = await readBlobDataUrl(key, db, doc.filePath);
        return blob ? jsonResponse({ dataUrl: blob.dataUrl, mimeType: blob.mimeType, title: doc.title }) : jsonResponse({ error: 'Brak pliku.' }, 404);
      }
      if (method === 'PATCH') {
        const body = parseBody();
        if (typeof body.title === 'string') doc.title = body.title;
        if (body.folderId !== undefined) doc.folderId = Number(body.folderId);
        if (body.physicalLocation !== undefined) doc.physicalLocation = body.physicalLocation;
        if (body.isArchived !== undefined) doc.isArchived = Boolean(body.isArchived);
        if (body.isDeleted !== undefined) { doc.isDeleted = Boolean(body.isDeleted); doc.deletedAt = doc.isDeleted ? new Date().toISOString() : null; }
        if (body.retentionEnabled !== undefined) doc.retentionEnabled = Boolean(body.retentionEnabled);
        if (body.retentionValue !== undefined) doc.retentionValue = Number(body.retentionValue);
        if (body.retentionUnit !== undefined) doc.retentionUnit = String(body.retentionUnit);
        if (Array.isArray(body.tagIds)) doc.tagIds = body.tagIds.map(Number);
        doc.updatedAt = new Date().toISOString();
        await writeDb(key, db);
        return jsonResponse(doc);
      }
      if (method === 'DELETE') {
        delete db.blobs[doc.filePath];
        db.documents = db.documents.filter(d => d.id !== docId);
        await writeDb(key, db, undefined, [doc.filePath]);
        return jsonResponse({ deleted: 1 });
      }
    }

    if (pathname === '/api/tags' && method === 'GET') {
      const db = await readDb(key);
      return jsonResponse(db.tags);
    }

    if (pathname === '/api/tags' && method === 'POST') {
      const db = await readDb(key);
      const body = parseBody();
      const tag: LocalTag = { id: db.nextTagId++, name: String(body.name || 'Tag').trim(), color: String(body.color || '#3b82f6') };
      db.tags.push(tag);
      await writeDb(key, db);
      return jsonResponse(tag);
    }

    const tagMatch = /^\/api\/tags\/(\d+)$/.exec(pathname);
    if (tagMatch && method === 'DELETE') {
      const tagId = Number(tagMatch[1]);
      const db = await readDb(key);
      db.tags = db.tags.filter(t => t.id !== tagId);
      for (const d of db.documents) d.tagIds = d.tagIds.filter(id => id !== tagId);
      await writeDb(key, db);
      return jsonResponse({ success: true });
    }

    if (pathname === '/api/analytics/summary' && method === 'GET') {
      const db = await readDb(key);
      return jsonResponse(buildLocalAnalytics(db, searchParams.get('month') || undefined));
    }

    return networkFetch(input, init);
  };
  (localFetch as typeof fetch & { [LOCAL_TESTER_FETCH_FLAG]?: boolean })[LOCAL_TESTER_FETCH_FLAG] = true;
  return localFetch;
}
