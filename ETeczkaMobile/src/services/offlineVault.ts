import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import CryptoJS from "crypto-js";
import { getApiUrl, getAuthHeaders } from "./localConnection";
import { fetchWithTimeout } from "./networkRequest";
import { createOfflineChunkStore } from './offlineChunks';
import { downloadSecureFile } from './secureFileTransfer';
import { createOfflineChunkCodec } from './offlineChunkCodec';
import { getOfflineCacheBytes, removeOfflineFiles } from './offlineCleanup';
import type { MobileDocument } from "../types/navigation";

const KEY = "eteczka.vault.key";
const PIN_HASH = "eteczka.vault.pin";
const MODE = "eteczka.vault.mode";
const BACKUP_MODE = "eteczka.vault.backup-mode";
const ROOT = `${FileSystem.documentDirectory}eteczka-vault/`;
const INDEX = `${ROOT}index.enc`;
const SELECTED_FOLDERS = "eteczka.vault.offline-folders";
const { decryptFileInChunks, encryptFileInChunks, readChunkManifest } = createOfflineChunkStore(FileSystem, Crypto.getRandomBytesAsync);

const hashPin = (pin: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `eteczka:${pin}`);
async function key(): Promise<CryptoJS.lib.WordArray> {
  const value = await SecureStore.getItemAsync(KEY);
  if (!value) throw new Error("Sejf nie jest skonfigurowany.");
  return CryptoJS.enc.Hex.parse(value);
}
const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function encrypt(value: string) { const iv = CryptoJS.enc.Hex.parse(hex(await Crypto.getRandomBytesAsync(16))); return `${iv.toString()}:${CryptoJS.AES.encrypt(value, await key(), { iv }).ciphertext.toString()}`; }
async function decrypt(value: string) {
  const [ivHex, ciphertext] = value.split(":");
  if (!ivHex || !ciphertext) throw new Error("Nieprawidłowy format danych sejfu.");
  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Hex.parse(ciphertext) });
  const plain = CryptoJS.AES.decrypt(cipherParams, await key(), { iv: CryptoJS.enc.Hex.parse(ivHex) }).toString(CryptoJS.enc.Utf8);
  if (!plain) throw new Error("Nie można odblokować sejfu.");
  return plain;
}
const chunkCodec = { encrypt, decrypt, ...createOfflineChunkCodec(key, Crypto.getRandomBytesAsync) };

export async function hasVault() { return Boolean(await SecureStore.getItemAsync(KEY)); }
export type VaultMode = "pin" | "password" | "pattern" | "biometric";
export async function vaultMode(): Promise<VaultMode> { return (await SecureStore.getItemAsync(MODE) as VaultMode) || "pin"; }
export type SecretMode = "pin" | "password" | "pattern";
export async function vaultFallbackMode(): Promise<SecretMode | null> { return (await SecureStore.getItemAsync(BACKUP_MODE) as SecretMode) || null; }
function validateSecret(secret: string, mode: SecretMode) {
  if (mode === "pattern" && (!/^[0-8](?:-[0-8]){3,8}$/.test(secret) || new Set(secret.split("-")).size !== secret.split("-").length)) throw new Error("Wzór musi łączyć co najmniej 4 różne punkty.");
  if (mode === "pin" && !/^\d{6,}$/.test(secret)) throw new Error("PIN musi mieć co najmniej 6 cyfr.");
  if (mode === "password" && secret.length < 8) throw new Error("Hasło musi mieć co najmniej 8 znaków.");
}
export async function createVault(secret: string, mode: VaultMode, backup?: { mode: SecretMode; secret: string }) {
  if (await hasVault()) throw new Error("Sejf już istnieje. Zmień metodę dostępu w ustawieniach, aby zachować dokumenty.");
  if (mode === "biometric") {
    if (!backup) throw new Error("Dla biometrii ustaw dodatkowy PIN albo hasło awaryjne.");
    validateSecret(backup.secret, backup.mode);
  } else validateSecret(secret, mode);
  await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true });
  await SecureStore.setItemAsync(KEY, hex(await Crypto.getRandomBytesAsync(32)));
  await SecureStore.setItemAsync(PIN_HASH, await hashPin(mode === "biometric" ? backup!.secret : secret));
  if (mode === "biometric") await SecureStore.setItemAsync(BACKUP_MODE, backup!.mode);
  else await SecureStore.deleteItemAsync(BACKUP_MODE);
  await SecureStore.setItemAsync(MODE, mode);
  await FileSystem.writeAsStringAsync(INDEX, await encrypt("[]"));
}
export async function changeVaultAccess(secret: string, mode: VaultMode, backup?: { mode: SecretMode; secret: string }) {
  if (mode === "biometric") {
    if (!backup) throw new Error("Dla biometrii ustaw dodatkowy PIN albo hasło awaryjne.");
    validateSecret(backup.secret, backup.mode);
  } else validateSecret(secret, mode);
  await SecureStore.setItemAsync(PIN_HASH, await hashPin(mode === "biometric" ? backup!.secret : secret));
  if (mode === "biometric") await SecureStore.setItemAsync(BACKUP_MODE, backup!.mode);
  else await SecureStore.deleteItemAsync(BACKUP_MODE);
  await SecureStore.setItemAsync(MODE, mode);
}
export async function unlockWithPin(pin: string) {
  const raw = await SecureStore.getItemAsync('eteczka.vault.attempts');
  const attempts = raw ? JSON.parse(raw) as { count: number; blockedUntil: number } : { count: 0, blockedUntil: 0 };
  if (attempts.blockedUntil > Date.now()) throw new Error('Zbyt wiele prób. Poczekaj chwilę i spróbuj ponownie.');
  const valid = (await SecureStore.getItemAsync(PIN_HASH)) === await hashPin(pin);
  if (valid) await SecureStore.deleteItemAsync('eteczka.vault.attempts');
  else { attempts.count++; attempts.blockedUntil = attempts.count >= 5 ? Date.now() + Math.min(300000, 30000 * (attempts.count - 4)) : 0; await SecureStore.setItemAsync('eteczka.vault.attempts', JSON.stringify(attempts)); }
  return valid;
}
export async function getOfflineFolderIds(): Promise<number[]> { try { return JSON.parse(await SecureStore.getItemAsync(SELECTED_FOLDERS) || "[]"); } catch { return []; } }
export async function setOfflineFolderIds(ids: number[]) { await SecureStore.setItemAsync(SELECTED_FOLDERS, JSON.stringify([...new Set(ids)])); }
export async function getVaultStorageBytes() {
  const sizeOfDirectory = async (dir: string): Promise<number> => {
    let total = 0;
    for (const name of await FileSystem.readDirectoryAsync(dir)) {
      const path = `${dir}${name}`; const info = await FileSystem.getInfoAsync(path);
      if (info.exists && info.isDirectory) total += await sizeOfDirectory(`${path}/`);
      else if (info.exists && 'size' in info) total += Number(info.size || 0);
    }
    return total;
  };
  try { return await sizeOfDirectory(ROOT); } catch { return 0; }
}
export async function getViewerCacheBytes() { try { return await getOfflineCacheBytes(FileSystem, FileSystem.cacheDirectory); } catch { return 0; } }

export type OfflineDocument = MobileDocument & {
  isDeleted?: boolean;
  isArchived?: boolean;
  createdAt?: string;
  retentionEnabled?: boolean;
  retentionValue?: number;
  retentionUnit?: string;
};

function isOfflineDocument(value: unknown): value is OfflineDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<OfflineDocument>;
  return typeof document.id === "number"
    && typeof document.title === "string"
    && typeof document.filePath === "string"
    && typeof document.mimeType === "string";
}

async function index(): Promise<OfflineDocument[]> {
  try {
    const parsed: unknown = JSON.parse(await decrypt(await FileSystem.readAsStringAsync(INDEX)));
    return Array.isArray(parsed) ? parsed.filter(isOfflineDocument) : [];
  } catch {
    return [];
  }
}

async function saveIndex(items: OfflineDocument[]) {
  const temporary = `${INDEX}.${Date.now()}.tmp`;
  try {
    await FileSystem.writeAsStringAsync(temporary, await encrypt(JSON.stringify(items)));
    await FileSystem.moveAsync({ from: temporary, to: INDEX });
  } catch (error) {
    await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

/** OCR is stored separately from the unencrypted catalog, using the vault key. */
export async function readOfflineOcr(id: number): Promise<string | null> {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  try { const value = await FileSystem.readAsStringAsync(`${ROOT}ocr-${id}.enc`); return CryptoJS.enc.Base64.parse(await chunkCodec.decryptChunk(value)).toString(CryptoJS.enc.Utf8); }
  catch { return null; }
}
export async function saveOfflineOcr(id: number, text: string) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Nieprawidłowy dokument.");
  const target = `${ROOT}ocr-${id}.enc`; const temporary = `${target}.${Date.now()}.tmp`;
  try { await FileSystem.writeAsStringAsync(temporary, await chunkCodec.encryptChunk(CryptoJS.enc.Utf8.parse(JSON.stringify({ text })).toString(CryptoJS.enc.Base64))); await FileSystem.moveAsync({ from: temporary, to: target }); }
  finally { await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined); }
}
export async function getOfflineOcr(id: number): Promise<string | null> {
  const value = await readOfflineOcr(id); if (!value) return null;
  try { const data: unknown = JSON.parse(value); return data && typeof data === 'object' && typeof (data as { text?: unknown }).text === 'string' ? (data as { text: string }).text : null; } catch { return null; }
}
export async function removeOfflineOcr(id: number) { await FileSystem.deleteAsync(`${ROOT}ocr-${id}.enc`, { idempotent: true }); }

let vaultBusy = false;

export async function clearOfflineCopies(onProgress?: (done: number, total: number) => void) {
  if (vaultBusy) throw new Error('Poczekaj na zakończenie pobierania dokumentów.');
  vaultBusy = true;
  try {
    await setOfflineFolderIds([]);
    const removed = await removeOfflineFiles(FileSystem, ROOT, FileSystem.cacheDirectory, onProgress);
    if (await hasVault()) await saveIndex([]);
    return removed;
  } finally { vaultBusy = false; }
}

export async function syncOfflineVault(onProgress?: (done: number, total: number, stage?: string) => void) {
  if (vaultBusy) throw new Error('Trwa już operacja na kopiach offline.');
  vaultBusy = true;
  try { return await syncOfflineVaultLocked(onProgress); }
  finally { vaultBusy = false; }
}

async function syncOfflineVaultLocked(onProgress?: (done: number, total: number, stage?: string) => void) {
  const response = await fetchWithTimeout(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() }, 30_000, 'Pobieranie listy dokumentów');
  if (!response.ok) throw new Error("Komputer nie udostępnił dokumentów.");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Komputer zwrócił nieprawidłową listę dokumentów.");
  const selectedFolders = await getOfflineFolderIds();
  if (!selectedFolders.length) throw new Error('Zaznacz przynajmniej jedną podkartotekę do pobrania offline.');
  const docs = payload.filter(isOfflineDocument).filter((document) => !document.isDeleted && typeof document.folderId === "number" && selectedFolders.includes(document.folderId));
  const current = await index(); const map = new Map(current.map((doc) => [doc.id, doc]));
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]; const target = `${ROOT}${doc.id}.enc`;
    const previous = map.get(doc.id);
    const localFile = await FileSystem.getInfoAsync(target);
    const manifest = await readChunkManifest(ROOT, doc.id, chunkCodec);
    const alreadyAvailable = manifest ? manifest.filePath === doc.filePath : Boolean(previous && previous.filePath === doc.filePath && localFile.exists);
    if (!alreadyAvailable) {
      const temporary = `${FileSystem.cacheDirectory}vault-${doc.id}-${Date.now()}.download`;
      const normalizedPath = doc.filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      const path = normalizedPath.toLowerCase().startsWith('uploads/') ? `/${normalizedPath}` : `/uploads/${normalizedPath}`;
      onProgress?.(i, docs.length, `Pobieranie: ${doc.title}`);
      let result: { status: number; uri: string };
      try { result = await downloadSecureFile(await getApiUrl(path), temporary, await getAuthHeaders(), (done, total) => { const amount = total > 0 ? ` ${Math.round(100 * done / total)}%` : ''; onProgress?.(i, docs.length, `Pobieranie: ${doc.title}${amount}`); }); }
      catch { throw new Error(`Nie udało się bezpiecznie pobrać dokumentu „${doc.title}”. Sprawdź połączenie z komputerem.`); }
      try {
        if (!result || result.status !== 200) throw new Error(`Komputer nie udostępnił dokumentu (HTTP ${result?.status ?? 'brak odpowiedzi'}).`);
        onProgress?.(i, docs.length, `Szyfrowanie: ${doc.title}`);
        await encryptFileInChunks(ROOT, doc.id, doc.filePath, temporary, chunkCodec, (done, total) => onProgress?.(i, docs.length, `Szyfrowanie: ${doc.title} ${Math.round(100 * done / total)}%`));
      } finally { await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined); }
    }
    // OCR is optional: a missing Premium subscription or unfinished job must not block the document download.
    try {
      const ocrResponse = await fetchWithTimeout(await getApiUrl(`/api/ocr/${doc.id}`), { headers: await getAuthHeaders() }, 10_000, 'Pobieranie tekstu OCR');
      if (ocrResponse.status === 402 || ocrResponse.status === 403 || ocrResponse.status === 404) await removeOfflineOcr(doc.id);
      else if (ocrResponse.ok) { const result: unknown = await ocrResponse.json(); const text = result && typeof result === 'object' ? (result as { text?: unknown }).text : null; if (typeof text === 'string' && text.length) await saveOfflineOcr(doc.id, text); else await removeOfflineOcr(doc.id); }
    } catch { /* Keep the previous encrypted copy when the connection is interrupted. */ }
    map.set(doc.id, doc); await saveIndex([...map.values()]); onProgress?.(i + 1, docs.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  }
  const allowed = new Set(docs.map((document) => document.id));
  for (const old of current) if (!allowed.has(old.id)) await removeOfflineOcr(old.id);
  await saveIndex([...map.values()].filter((doc) => allowed.has(doc.id)));
  return docs.length;
}
export async function offlineFile(document: Pick<OfflineDocument, "id" | "filePath">) {
  const encrypted = `${ROOT}${document.id}.enc`;
  const extension = document.filePath?.split(".").pop() || "pdf";
  const target = `${FileSystem.cacheDirectory}opened-${document.id}.${extension}`;
  const manifest = await readChunkManifest(ROOT, document.id, chunkCodec);
  if (manifest) {
    if (manifest.filePath !== document.filePath) throw new Error('Kopia offline dotyczy starszej wersji dokumentu.');
    return decryptFileInChunks(ROOT, document.id, target, manifest, chunkCodec);
  }
  if (!(await FileSystem.getInfoAsync(encrypted)).exists) throw new Error("Nie ma kopii offline.");
  await FileSystem.writeAsStringAsync(target, await decrypt(await FileSystem.readAsStringAsync(encrypted)), { encoding: FileSystem.EncodingType.Base64 });
  return target;
}
