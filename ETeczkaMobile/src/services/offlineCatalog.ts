import * as FileSystem from "expo-file-system/legacy";
import type { FolderSummary } from "../types/navigation";
import type { RetentionDocument } from "./retentionNotifications";

const ROOT = `${FileSystem.documentDirectory || ""}eteczka-catalog-cache`;
const foldersFile = `${ROOT}/folders.json`;
const documentsFile = (folderId: number) => `${ROOT}/documents-${folderId}.json`;

async function ensureRoot() { await FileSystem.makeDirectoryAsync(ROOT, { intermediates: true }); }
export async function saveCachedFolders(folders: FolderSummary[]) { await ensureRoot(); await FileSystem.writeAsStringAsync(foldersFile, JSON.stringify(folders)); }
export async function loadCachedFolders(): Promise<FolderSummary[]> { try { const info = await FileSystem.getInfoAsync(foldersFile); if (!info.exists) return []; return JSON.parse(await FileSystem.readAsStringAsync(foldersFile)) as FolderSummary[]; } catch { return []; } }
export async function saveCachedDocuments(folderId: number, documents: RetentionDocument[]) { await ensureRoot(); await FileSystem.writeAsStringAsync(documentsFile(folderId), JSON.stringify(documents)); }
export async function loadCachedDocuments(folderId: number): Promise<RetentionDocument[]> { try { const file = documentsFile(folderId); const info = await FileSystem.getInfoAsync(file); if (!info.exists) return []; return JSON.parse(await FileSystem.readAsStringAsync(file)) as RetentionDocument[]; } catch { return []; } }
