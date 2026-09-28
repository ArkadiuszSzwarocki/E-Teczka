import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import CryptoJS from "crypto-js";
import { getApiUrl, getAuthHeaders } from "./localConnection";
import type { MobileDocument } from "../types/navigation";

const KEY = "eteczka.vault.key";
const PIN_HASH = "eteczka.vault.pin";
const MODE = "eteczka.vault.mode";
const BACKUP_MODE = "eteczka.vault.backup-mode";
const ROOT = `${FileSystem.documentDirectory}eteczka-vault/`;
const INDEX = `${ROOT}index.enc`;

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

export async function hasVault() { return Boolean(await SecureStore.getItemAsync(KEY)); }
export type VaultMode = "pin" | "password" | "biometric";
export async function vaultMode(): Promise<VaultMode> { return (await SecureStore.getItemAsync(MODE) as VaultMode) || "pin"; }
export type SecretMode = "pin" | "password";
export async function vaultFallbackMode(): Promise<SecretMode | null> { return (await SecureStore.getItemAsync(BACKUP_MODE) as SecretMode) || null; }
function validateSecret(secret: string, mode: SecretMode) {
  if (mode === "pin" && !/^\d{6,}$/.test(secret)) throw new Error("PIN musi mieć co najmniej 6 cyfr.");
  if (mode === "password" && secret.length < 8) throw new Error("Hasło musi mieć co najmniej 8 znaków.");
}
export async function createVault(secret: string, mode: VaultMode, backup?: { mode: SecretMode; secret: string }) {
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
export async function unlockWithPin(pin: string) { return (await SecureStore.getItemAsync(PIN_HASH)) === await hashPin(pin); }

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
  await FileSystem.writeAsStringAsync(INDEX, await encrypt(JSON.stringify(items)));
}

export async function syncOfflineVault(onProgress?: (done: number, total: number) => void) {
  const response = await fetch(await getApiUrl("/api/documents"), { headers: await getAuthHeaders() });
  if (!response.ok) throw new Error("Komputer nie udostępnił dokumentów.");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Komputer zwrócił nieprawidłową listę dokumentów.");
  const docs = payload.filter(isOfflineDocument).filter((document) => !document.isDeleted);
  const current = await index(); const map = new Map(current.map((doc) => [doc.id, doc]));
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]; const target = `${ROOT}${doc.id}.enc`;
    if (!map.has(doc.id)) {
      const temporary = `${FileSystem.cacheDirectory}vault-${doc.id}`;
      await FileSystem.downloadAsync(await getApiUrl(`/uploads/${doc.filePath}`), temporary, { headers: await getAuthHeaders() });
      const base64 = await FileSystem.readAsStringAsync(temporary, { encoding: FileSystem.EncodingType.Base64 });
      await FileSystem.deleteAsync(temporary, { idempotent: true });
      await FileSystem.writeAsStringAsync(target, await encrypt(base64));
    }
    map.set(doc.id, doc); onProgress?.(i + 1, docs.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
  }
  const allowed = new Set(docs.map((document) => document.id));
  await saveIndex([...map.values()].filter((doc) => allowed.has(doc.id)));
  return docs.length;
}
export async function offlineFile(document: Pick<OfflineDocument, "id" | "filePath">) {
  const encrypted = `${ROOT}${document.id}.enc`;
  if (!(await FileSystem.getInfoAsync(encrypted)).exists) throw new Error("Nie ma kopii offline.");
  const extension = document.filePath?.split(".").pop() || "pdf";
  const target = `${FileSystem.cacheDirectory}opened-${document.id}.${extension}`;
  await FileSystem.writeAsStringAsync(target, await decrypt(await FileSystem.readAsStringAsync(encrypted)), { encoding: FileSystem.EncodingType.Base64 });
  return target;
}
