import { profileDirectory, profileOperation } from './mobileProfile';
import * as FileSystem from "expo-file-system/legacy";
import type { FolderSummary } from "../types/navigation";
import type { RetentionDocument } from "./retentionNotifications";

const ROOT = () => profileDirectory(`${FileSystem.documentDirectory || ""}mojateczka-catalog-cache`);
const foldersFile = () => `${ROOT()}/folders.json`;
const documentsFile = (folderId: number) => `${ROOT()}/documents-${folderId}.json`;

async function ensureRoot() { await FileSystem.makeDirectoryAsync(ROOT(), { intermediates: true }); }
async function saveCachedFoldersImpl(folders: FolderSummary[]) { await ensureRoot(); await FileSystem.writeAsStringAsync(foldersFile(), JSON.stringify(folders)); }
async function loadCachedFoldersImpl(): Promise<FolderSummary[]> { try { const info = await FileSystem.getInfoAsync(foldersFile()); if (!info.exists) return []; return JSON.parse(await FileSystem.readAsStringAsync(foldersFile())) as FolderSummary[]; } catch { return []; } }
async function saveCachedDocumentsImpl(folderId: number, documents: RetentionDocument[]) { await ensureRoot(); await FileSystem.writeAsStringAsync(documentsFile(folderId), JSON.stringify(documents)); }
async function loadCachedDocumentsImpl(folderId: number): Promise<RetentionDocument[]> { try { const file = documentsFile(folderId); const info = await FileSystem.getInfoAsync(file); if (!info.exists) return []; return JSON.parse(await FileSystem.readAsStringAsync(file)) as RetentionDocument[]; } catch { return []; } }
async function getCatalogStorageBytesImpl() { try { const names = await FileSystem.readDirectoryAsync(ROOT()); let total = 0; for (const name of names) { const info = await FileSystem.getInfoAsync(`${ROOT()}/${name}`); total += Number(info.exists && "size" in info ? info.size || 0 : 0); } return total; } catch { return 0; } }

export const saveCachedFolders = profileOperation(saveCachedFoldersImpl);
export const loadCachedFolders = profileOperation(loadCachedFoldersImpl);
export const saveCachedDocuments = profileOperation(saveCachedDocumentsImpl);
export const loadCachedDocuments = profileOperation(loadCachedDocumentsImpl);
export const getCatalogStorageBytes = profileOperation(getCatalogStorageBytesImpl);
