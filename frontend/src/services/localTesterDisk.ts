import { emptyLocalDb, type DirectoryPickerWindow, type LocalDatabase } from '../types/localTesterDb';

const DB_NAME = 'mojateczka_tester_local_db_v1';
const STORE_NAME = 'workspaces';
const HANDLE_STORE = 'handles';
const dbLocks = new Map<string, Promise<unknown>>();
const memoryDbCache = new Map<string, LocalDatabase>();

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

function withDbLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = dbLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  dbLocks.set(key, next.then(() => undefined, () => undefined));
  return next;
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
  for (let i = 0; i < view.length; i += chunk) binary += String.fromCharCode(...view.subarray(i, i + chunk));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function dataUrlToResponse(dataUrl: string, fallbackMime: string): Response {
  const parsed = dataUrlToBytes(dataUrl);
  if (!parsed) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(parsed.bytes).buffer, { status: 200, headers: { 'Content-Type': parsed.mimeType || fallbackMime } });
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
  return { hasHandle: true, granted: await verifyHandlePermission(handle, false), folderName: handle.name };
}

export async function requestSavedDiskPermission(userEmail: string): Promise<boolean> {
  const key = `user:${userEmail.trim().toLowerCase()}`;
  const handle = await getDiskHandle(key);
  if (!handle) return false;
  const ok = await verifyHandlePermission(handle, true);
  if (ok) memoryDbCache.delete(key);
  return ok;
}

/** Prompts the user to pick a local disk folder and initializes `mojateczka-db.json` + `uploads/` inside it. */
export async function pickTesterDiskDirectory(userEmail: string): Promise<string> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Twoja przeglądarka nie obsługuje zapisu bezpośrednio do folderu na dysku. Użyj Chrome lub Edge na komputerze.');
  const handle = await picker({ id: 'mojateczka-local-db', mode: 'readwrite' });
  if (!(await verifyHandlePermission(handle, true))) throw new Error('Nie przyznano uprawnień zapisu do wybranego folderu.');

  const key = `user:${userEmail.trim().toLowerCase()}`;
  await saveDiskHandle(key, handle);
  memoryDbCache.delete(key);
  await handle.getDirectoryHandle('uploads', { create: true });
  try {
    await handle.getFileHandle('mojateczka-db.json', { create: false });
  } catch {
    const fileHandle = await handle.getFileHandle('mojateczka-db.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(emptyLocalDb(), null, 2));
    await writable.close();
  }
  return handle.name;
}

export async function readLocalDb(key: string): Promise<LocalDatabase> {
  return withDbLock(key, async () => {
    const diskHandle = await getDiskHandle(key);
    if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
      try {
        const fileHandle = await diskHandle.getFileHandle('mojateczka-db.json', { create: false });
        const text = await (await fileHandle.getFile()).text();
        if (text.trim()) {
          const parsed = JSON.parse(text) as LocalDatabase;
          const db: LocalDatabase = {
            ...emptyLocalDb(),
            ...parsed,
            folders: Array.isArray(parsed.folders) ? parsed.folders : [],
            documents: Array.isArray(parsed.documents) ? parsed.documents : [],
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            blobs: parsed.blobs || {},
          };
          memoryDbCache.set(key, db);
          return db;
        }
      } catch {
        return memoryDbCache.get(key) ?? emptyLocalDb();
      }
    }
    const cached = memoryDbCache.get(key);
    if (cached) return cached;
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as LocalDatabase | undefined) ?? emptyLocalDb());
      req.onerror = () => reject(req.error || new Error('Błąd odczytu lokalnej bazy.'));
    });
  });
}

export async function writeLocalDb(key: string, db: LocalDatabase, changedFiles?: Array<{ name: string; dataUrl: string }>, deletedFiles?: string[]): Promise<void> {
  return withDbLock(key, async () => {
    memoryDbCache.set(key, db);
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
      const compact: LocalDatabase = {
        ...db,
        blobs: Object.fromEntries(Object.entries(db.blobs).map(([k, v]) => [k, { mimeType: v.mimeType, dataUrl: '', size: v.size }])),
      };
      const dbFile = await diskHandle.getFileHandle('mojateczka-db.json', { create: true });
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
  });
}

export async function readBlobDataUrl(key: string, db: LocalDatabase, filename: string): Promise<{ mimeType: string; dataUrl: string } | null> {
  const meta = db.blobs[filename];
  if (meta?.dataUrl) return { mimeType: meta.mimeType, dataUrl: meta.dataUrl };
  const diskHandle = await getDiskHandle(key);
  if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
    try {
      const uploadsHandle = await diskHandle.getDirectoryHandle('uploads', { create: false });
      const file = await (await uploadsHandle.getFileHandle(filename, { create: false })).getFile();
      const mimeType = meta?.mimeType || file.type || 'application/octet-stream';
      return { mimeType, dataUrl: bytesToDataUrl(await file.arrayBuffer(), mimeType) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Permanently deletes all local disk files (`mojateczka-db.json` + `uploads/`) and IndexedDB state for the user. */
export async function clearLocalTesterWorkspace(userEmail: string): Promise<void> {
  const key = `user:${userEmail.trim().toLowerCase()}`;
  const diskHandle = await getDiskHandle(key);
  if (diskHandle && await verifyHandlePermission(diskHandle, false)) {
    try { await diskHandle.removeEntry('uploads', { recursive: true }); } catch { /* ignore */ }
    try { await diskHandle.removeEntry('mojateczka-db.json'); } catch { /* ignore */ }
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
