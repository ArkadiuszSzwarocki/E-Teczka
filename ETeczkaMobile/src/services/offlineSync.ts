import * as FileSystem from "expo-file-system/legacy";
import { getApiUrl, getAuthHeaders } from "./localConnection";
import { fetchWithTimeout } from "./networkRequest";
import { loadCachedDocuments, loadCachedFolders, saveCachedDocuments, saveCachedFolders } from "./offlineCatalog";
import type { FolderSummary } from "../types/navigation";
import { isRetentionDocument, type RetentionDocument } from "./retentionNotifications";

type Entity = "folders" | "documents";
export type PendingChange = { entity: Entity; operation: "created" | "updated" | "deleted"; value: Record<string, unknown>; queuedAt: string };
type SyncState = { lastPulledAt: number; queue: PendingChange[]; conflicts: number };
const ROOT = `${FileSystem.documentDirectory || ""}eteczka-sync`;
const STATE = `${ROOT}/state.json`;
const ensure = () => FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
async function readState(): Promise<SyncState> {
  const info = await FileSystem.getInfoAsync(STATE);
  if (!info.exists) return { lastPulledAt: 0, queue: [], conflicts: 0 };
  try {
    const state: unknown = JSON.parse(await FileSystem.readAsStringAsync(STATE));
    if (!state || typeof state !== 'object' || !Array.isArray((state as SyncState).queue) || !Number.isFinite((state as SyncState).lastPulledAt) || !Number.isFinite((state as SyncState).conflicts)) throw new Error('invalid state');
    return state as SyncState;
  } catch {
    throw new Error('Nie udało się odczytać kolejki synchronizacji. Dane pozostawiono na telefonie.');
  }
}
async function writeState(state: SyncState) { await ensure(); await FileSystem.writeAsStringAsync(STATE, JSON.stringify(state)); }
// Serialize read-modify-write operations so a sync cannot overwrite a change
// queued by another screen while its network request is in progress.
let stateOperation: Promise<void> = Promise.resolve();
function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const result = stateOperation.then(action);
  stateOperation = result.then(() => undefined, () => undefined);
  return result;
}
export async function pendingChangeCount() { return (await readState()).queue.length; }
export async function queueOfflineChange(change: Omit<PendingChange, "queuedAt">) { return exclusive(async () => { const state = await readState(); const id = Number(change.value.id); state.queue = state.queue.filter(item => !(item.entity === change.entity && Number(item.value.id) === id && item.operation !== "created")); state.queue.push({ ...change, queuedAt: new Date().toISOString() }); await writeState(state); }); }
export async function cancelPendingFolderCreation(clientId: string) { return exclusive(async () => {
  const state = await readState();
  const index = state.queue.findIndex(item => item.entity === 'folders' && item.operation === 'created' && item.value.clientId === clientId);
  if (index < 0) throw new Error('Nie znaleziono oczekującej operacji utworzenia kartoteki.');
  state.queue.splice(index, 1);
  await writeState(state);
}); }
export async function getSyncInfo() { const state = await readState(); return { pending: state.queue.length, conflicts: state.conflicts, lastPulledAt: state.lastPulledAt }; }

function newer(remote: Record<string, unknown>, local?: Record<string, unknown>) { if (!local) return true; const r = Date.parse(String(remote.updatedAt || remote.createdAt || 0)); const l = Date.parse(String(local.updatedAt || local.createdAt || 0)); return Number.isFinite(r) && Number.isFinite(l) ? r >= l : true; }
async function mergeRemote(changes: any, state: SyncState) {
  const folders = [...(changes?.folders?.created || []), ...(changes?.folders?.updated || [])] as FolderSummary[];
  if (folders.length) { const current = await loadCachedFolders(); const map = new Map(current.map(item => [item.id, item])); for (const folder of folders) { const pending = state.queue.find(item => item.entity === "folders" && Number(item.value.id) === folder.id); if (!pending || newer(folder, pending.value)) map.set(folder.id, folder); else state.conflicts++; } await saveCachedFolders([...map.values()]); }
  const docs = [...(changes?.documents?.created || []), ...(changes?.documents?.updated || [])] as RetentionDocument[];
  for (const doc of docs) { const folderId = Number(doc.folderId); if (!folderId) continue; const current = await loadCachedDocuments(folderId); const map = new Map(current.map(item => [item.id, item])); const pending = state.queue.find(item => item.entity === "documents" && Number(item.value.id) === doc.id); if (!pending || newer(doc as any, pending.value)) { if (doc.isDeleted) map.delete(doc.id); else map.set(doc.id, doc); } else state.conflicts++; await saveCachedDocuments(folderId, [...map.values()]); }
}
export async function syncNow() { return exclusive(syncNowLocked); }
export async function syncOfflineCatalog(folderIds: number[]) {
  return exclusive(async () => {
    const result = await syncNowLocked();
    const headers = await getAuthHeaders();
    const getList = async (path: string): Promise<unknown[]> => {
      {
        const response = await fetchWithTimeout(await getApiUrl(path), { headers }, 30_000, 'Pobieranie listy kartotek i dokumentów');
        if (!response.ok) throw new Error('Komputer nie udostępnił listy kartotek lub dokumentów.');
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error('Komputer zwrócił nieprawidłowe dane.');
        return data;
      }
    };
    const folders = await getList('/api/folders');
    const documents: { id: number; values: RetentionDocument[] }[] = [];
    for (const id of folderIds) documents.push({ id, values: (await getList(`/api/documents?folderId=${id}`)).filter(isRetentionDocument).filter(doc => !doc.isDeleted && !doc.isArchived) });
    await saveCachedFolders(folders.filter((item): item is FolderSummary => Boolean(item) && typeof item === 'object' && Number.isInteger((item as FolderSummary).id) && typeof (item as FolderSummary).name === 'string'));
    for (const entry of documents) await saveCachedDocuments(entry.id, entry.values);
    return result;
  });
}
async function syncNowLocked() {
  const fetch = async (input: string, init: RequestInit = {}) => {
    return fetchWithTimeout(input, init, 30_000, 'Synchronizacja z komputerem');
  };
  const state = await readState();
  const pull = await fetch(`${await getApiUrl(`/api/sync?lastPulledAt=${state.lastPulledAt}`)}`, { headers: await getAuthHeaders() });
  if (!pull.ok) throw new Error("Komputer nie odpowiedział na synchronizację.");
  const pulled: any = await pull.json(); await mergeRemote(pulled.changes, state);
  // Send folder creations separately: their clientId remains stable across
  // retries, so a lost response cannot create a second folder on the server.
  for (const change of [...state.queue]) {
    if (change.entity !== 'folders' || change.operation !== 'created') continue;
    const clientId = change.value.clientId;
    if (typeof clientId !== 'string' || !clientId) throw new Error('Kartoteka offline nie ma identyfikatora synchronizacji.');
    const response = await fetch(await getApiUrl('/api/sync/operation'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() }, body: JSON.stringify({ operationId: clientId, operation: { entity: 'folders', type: 'created', value: change.value } }) });
    if (!response.ok) throw new Error('Nie udało się zsynchronizować kartoteki. Zmiana pozostała w kolejce.');
    const receipt: unknown = await response.json();
    const result = receipt as { success?: boolean; value?: { clientId?: string; id?: number } };
    if (result.success !== true || result.value?.clientId !== clientId || !Number.isInteger(result.value?.id) || Number(result.value?.id) < 1) throw new Error('Komputer nie potwierdził zapisania kartoteki.');
    const cached = await loadCachedFolders();
    await saveCachedFolders(cached.map(folder => folder.clientId === clientId ? { ...folder, id: Number(result.value!.id), clientId: undefined } : folder));
    state.queue = state.queue.filter(item => item !== change);
    await writeState(state);
  }
  for (const change of [...state.queue]) {
    if (change.operation !== 'updated') continue;
    const id = Number(change.value.id);
    if (!Number.isInteger(id) || id < 1 || !change.queuedAt) throw new Error('Zmiana nie ma identyfikatora synchronizacji.');
    const operationId = `${change.entity}-${id}-${change.queuedAt}`;
    const response = await fetch(await getApiUrl('/api/sync/operation'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() }, body: JSON.stringify({ operationId, operation: { entity: change.entity, type: 'updated', value: change.value } }) });
    if (!response.ok) throw new Error('Nie udało się zsynchronizować zmiany. Pozostała w kolejce.');
    const receipt = await response.json() as { success?: boolean; value?: { id?: number; conflict?: boolean } };
    if (receipt.success !== true || receipt.value?.id !== id || typeof receipt.value.conflict !== 'boolean') throw new Error('Komputer nie potwierdził zmiany.');
    if (receipt.value.conflict) throw new Error('Element zmienił się na komputerze. Lokalna zmiana pozostała w kolejce.');
    state.queue = state.queue.filter(item => item !== change);
    await writeState(state);
  }
  for (const change of [...state.queue]) {
    if (change.entity !== 'folders' || change.operation !== 'deleted') continue;
    const id = Number(change.value.id);
    if (!Number.isInteger(id) || id < 1 || !change.queuedAt) throw new Error('Usunięcie kartoteki nie ma poprawnego identyfikatora.');
    const response = await fetch(await getApiUrl('/api/sync/operation'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...await getAuthHeaders() }, body: JSON.stringify({ operationId: `folder-delete-${id}-${change.queuedAt}`, operation: { entity: 'folders', type: 'deleted', value: change.value } }) });
    if (!response.ok) throw new Error('Nie udało się zsynchronizować usunięcia kartoteki. Mogła zostać zmieniona lub zawierać dane na komputerze.');
    const receipt = await response.json() as { success?: boolean; value?: { id?: number } };
    if (receipt.success !== true || receipt.value?.id !== id) throw new Error('Komputer nie potwierdził usunięcia kartoteki.');
    state.queue = state.queue.filter(item => item !== change);
    await writeState(state);
  }
  if (state.queue.length) throw new Error("Część zmian oczekuje na obsługę synchronizacji. Pozostały bezpiecznie w kolejce.");
  state.lastPulledAt = Number(pulled.timestamp || Date.now()); await writeState(state); return { pending: 0, conflicts: state.conflicts };
}
