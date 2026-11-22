import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { securityDir } from '../config/paths';
import { encrypt, decrypt } from './backupCrypto';
import { getAccessibleFolderIds } from './familyAccess';
import { classifyDocumentOffline } from './documentFolderClassifier';
import { getLearnedFolderBoosts } from './folderLearningStore';
import { listMailItems, saveMailItem, type MailInboxItem } from './mailInboxStore';
import { extractQuickPdfText } from './pdfQuickText';
import { parseKsefXml } from './ksefXmlParser';
import { parseEReceiptPayload } from './eReceiptParser';

export type WatchFolderConfig = {
  folderPath: string;
  enabled: boolean;
};

const WATCH_FILE = path.join(securityDir, 'watch-folders.enc');
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.xml', '.json']);
const MAX_BYTES = 25 * 1024 * 1024;

function readAll(): Record<string, WatchFolderConfig> {
  try {
    const raw = fs.readFileSync(WATCH_FILE, 'utf8');
    const parsed = JSON.parse(decrypt(raw)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, WatchFolderConfig>) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

function writeAll(data: Record<string, WatchFolderConfig>): void {
  fs.mkdirSync(path.dirname(WATCH_FILE), { recursive: true });
  const tmp = `${WATCH_FILE}.tmp`;
  fs.writeFileSync(tmp, encrypt(JSON.stringify(data)), { mode: 0o600 });
  fs.renameSync(tmp, WATCH_FILE);
}

export function getWatchFolderConfig(ownerId: number): WatchFolderConfig {
  return readAll()[`user:${ownerId}`] || { folderPath: '', enabled: false };
}

export function saveWatchFolderConfig(ownerId: number, config: WatchFolderConfig): WatchFolderConfig {
  const cleanedPath = config.folderPath.trim();
  if (cleanedPath && (!path.isAbsolute(cleanedPath) || !fs.existsSync(cleanedPath) || !fs.statSync(cleanedPath).isDirectory())) {
    throw new Error('Wskazany folder nie istnieje lub nie jest katalogiem.');
  }
  const all = readAll();
  const next: WatchFolderConfig = { folderPath: cleanedPath, enabled: Boolean(config.enabled && cleanedPath) };
  all[`user:${ownerId}`] = next;
  writeAll(all);
  return next;
}

function guessMime(ext: string): string {
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.xml') return 'application/xml';
  if (ext === '.json') return 'application/json';
  return 'image/jpeg';
}

type FolderLite = { id: number; name: string; parentId: number | null };

async function loadOwnerFolders(prisma: PrismaClient, ownerId: number): Promise<FolderLite[]> {
  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  return prisma.folder.findMany({
    where: { id: { in: accessibleIds } },
    select: { id: true, name: true, parentId: true },
  });
}

async function ingestWatchBuffer(
  ownerId: number,
  folders: FolderLite[],
  name: string,
  buffer: Buffer,
  sourceLabel: string,
  receivedAt: Date,
  uidOffset: number,
): Promise<boolean> {
  if (!buffer.length || buffer.length > MAX_BYTES) return false;
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return false;

  const pdfText = ext === '.pdf' ? await extractQuickPdfText(buffer) : '';
  const ksefText = ext === '.xml' ? (parseKsefXml(buffer.toString('utf8'))?.summaryText || '') : '';
  const eReceiptText = ext === '.json' ? (parseEReceiptPayload(buffer.toString('utf8'))?.summaryText || '') : '';
  const extractedText = [name, pdfText, ksefText, eReceiptText].filter(Boolean).join('\n');
  const learnedBoosts = getLearnedFolderBoosts(ownerId, extractedText);
  const classified = classifyDocumentOffline(extractedText, folders, learnedBoosts);
  const top = classified.suggestions[0] || null;

  const id = crypto.randomUUID();
  const item: MailInboxItem = {
    id,
    uid: Date.now() + uidOffset,
    filename: name,
    storedName: `${id}${ext}`,
    mimeType: guessMime(ext),
    size: buffer.length,
    subject: sourceLabel,
    from: 'Folder obserwowany',
    receivedAt: receivedAt.toISOString(),
    suggestedFolderId: top ? top.folderId : null,
    suggestedFolderName: top ? top.folderName : null,
    detectedLabel: classified.detectedLabel,
    reason: top ? top.reason : 'Przeciągnij na kartotekę',
    extractedText,
  };

  saveMailItem(ownerId, item, buffer);
  return true;
}

/** Scans the configured local Watch Folder, classifies files offline, and moves them to staging. */
export async function scanWatchFolder(prisma: PrismaClient, ownerId: number): Promise<{ added: number; items: MailInboxItem[] }> {
  const cfg = getWatchFolderConfig(ownerId);
  if (!cfg.folderPath) throw new Error('Najpierw wskaż ścieżkę gorącego folderu.');
  if (!fs.existsSync(cfg.folderPath)) throw new Error('Wskazany gorący folder nie istnieje.');

  const folders = await loadOwnerFolders(prisma, ownerId);

  let added = 0;
  for (const name of fs.readdirSync(cfg.folderPath)) {
    const fullPath = path.join(cfg.folderPath, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch { continue; }
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_BYTES) continue;

    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;

    const buffer = fs.readFileSync(fullPath);
    const saved = await ingestWatchBuffer(ownerId, folders, name, buffer, cfg.folderPath, stat.mtime, added);
    if (!saved) continue;
    fs.unlinkSync(fullPath);
    added++;
  }

  return { added, items: listMailItems(ownerId) };
}

/** Ingests files uploaded from a browser/Android watch folder selection into staging. */
export async function ingestWatchUploadBatch(
  prisma: PrismaClient,
  ownerId: number,
  sourceLabel: string,
  files: Array<{ name: string; buffer: Buffer; modifiedAt?: Date }>,
): Promise<{ added: number; items: MailInboxItem[] }> {
  const folders = await loadOwnerFolders(prisma, ownerId);
  const label = sourceLabel.trim().slice(0, 160) || 'Folder na telefonie';
  let added = 0;
  for (const file of files) {
    const saved = await ingestWatchBuffer(ownerId, folders, file.name, file.buffer, label, file.modifiedAt || new Date(), added);
    if (saved) added++;
  }
  return { added, items: listMailItems(ownerId) };
}
