import { ensurePlanLedger, mergePlanState, parseBackupPlanState, getPlan, checkDocumentCapacity, checkTagCapacity } from './planLedger';
import {centralOwner,requireSynchronizedCentralPlan} from './centralPlanLedger';
import { prepareTags } from './tagOwnership';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { decryptBackup } from './backupCrypto';
import { protectOcrText, readOcrText } from './ocrText';

type SourceFolder = { id: number; name: string; parentId?: number | null; order?: number; createdAt?: string };
type SourceLineItem = { name: string; quantity?: number; totalCents: number; category?: string };
type SourceDocument = {
  id: number; title: string; filePath: string; mimeType: string; folderId: number;
  retentionEnabled?: boolean; retentionValue?: number; retentionUnit?: string;
  isArchived?: boolean; isDeleted?: boolean; deletedAt?: string | null; createdAt?: string;
  physicalLocation?: string | null; thumbnail?: string | null; ocrText?: string | null;
  merchantName?: string | null; amountCents?: number | null; currency?: string | null;
  dueDate?: string | null; paymentStatus?: string | null;
  tags?: Array<{ name: string; color?: string }>;
  lineItems?: SourceLineItem[];
};
type Manifest = { version: number; folders: SourceFolder[]; documents: SourceDocument[] };

function parseManifest(zip: AdmZip): Manifest {
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('Nieprawidłowa kopia: brak manifestu.');
  let value: Manifest;
  try { value = JSON.parse(entry.getData().toString('utf8')); }
  catch { throw new Error('Nieprawidłowy manifest kopii.'); }
  if (value?.version !== 1 || !Array.isArray(value.folders) || !Array.isArray(value.documents)) throw new Error('Nieobsługiwana wersja kopii zapasowej.');
  const folderIds = new Set<number>();
  for (const folder of value.folders) {
    if (!Number.isInteger(folder.id) || folder.id < 1 || folderIds.has(folder.id) || typeof folder.name !== 'string') throw new Error('Nieprawidłowe kartoteki w kopii.');
    folderIds.add(folder.id);
  }
  const documentIds = new Set<number>();
  for (const document of value.documents) {
    if (!Number.isInteger(document.id) || document.id < 1 || documentIds.has(document.id) || !folderIds.has(document.folderId) || typeof document.filePath !== 'string' || !document.filePath || typeof document.title !== 'string') throw new Error('Nieprawidłowe dokumenty w kopii.');
    documentIds.add(document.id);
    if (!zip.getEntry(`files/${document.id}-${path.basename(document.filePath)}`)) throw new Error(`Brak pliku dokumentu ${document.id} w kopii.`);
  }
  for (const folder of value.folders) if (folder.parentId && !folderIds.has(folder.parentId)) throw new Error('Nieprawidłowa hierarchia kartotek.');
  return value;
}

export async function restoreBackup(prisma: PrismaClient, encryptedData: Buffer, ownerId: number, userId: number | null, targetDir = uploadsDir, recoveryKey?: Buffer, planOwnerKey = userId ? `user:${userId}` : 'desktop-local') {
  const central=centralOwner(planOwnerKey);if(central)await requireSynchronizedCentralPlan(prisma,planOwnerKey);
  const centralPlan=central?await getPlan(prisma,planOwnerKey):null;
  const zip = new AdmZip(decryptBackup(encryptedData, recoveryKey));
  const manifest = parseManifest(zip);
  const rawManifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8')) as { planState?: unknown };
  const planState = parseBackupPlanState(rawManifest.planState);
  if (planState) await ensurePlanLedger(prisma);
  if (manifest.documents.some(document => document.tags?.length)) await prepareTags(prisma);
  // Re-encrypt OCR data with this installation's key before committing any changes.
  for (const document of manifest.documents) if (typeof document.ocrText === 'string' && document.ocrText) document.ocrText = protectOcrText(readOcrText(document.ocrText, recoveryKey));
  const parseDate = (value: string | null | undefined) => {
    if (!value) return undefined;
    const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error('Nieprawidłowa data w kopii zapasowej.');
    return date;
  };
  for (const folder of manifest.folders) parseDate(folder.createdAt);
  for (const document of manifest.documents) { parseDate(document.createdAt); parseDate(document.deletedAt); parseDate(document.dueDate); }
  const writtenFiles: string[] = [];
  const folderMap = new Map<number, number>();
  try {
    await prisma.$transaction(async tx => {
      if(central&&centralPlan){const count=await tx.document.count({where:{folder:{ownerId}}});const growth=manifest.documents.length-count;if(growth>0)await checkDocumentCapacity(tx,ownerId,centralPlan,growth);const tables=await tx.$queryRawUnsafe<Array<{name:string}>>("SELECT name FROM sqlite_master WHERE type='table' AND name='PlanTagOwner'");const existing=tables.length?await tx.$queryRawUnsafe<Array<{name:string}>>('SELECT t.name FROM Tag t JOIN PlanTagOwner o ON o.tagId=t.id WHERE o.ownerId=?',ownerId):[];const names=new Set(existing.map(t=>t.name));const added=new Set(manifest.documents.flatMap(d=>(d.tags||[]).map(t=>String(t.name||'tag').slice(0,80))).filter(name=>!names.has(name)));if(added.size)await checkTagCapacity(tx,ownerId,centralPlan,existing.length,added.size);}
      if (planState) await mergePlanState(tx, planOwnerKey, planState);
      // The archive is a snapshot, not an import. Replace only this owner's
      // data inside one transaction. Other accounts must never be touched.
      // Version 1 backups do not contain folder shares. Refuse to discard
      // permissions silently; restore can proceed after they are handled.
      const shares = await tx.folderShare.count({ where: { folder: { ownerId } } });
      if (shares) throw new Error('Nie można przywrócić kopii: obecne kartoteki są udostępnione innym użytkownikom, a kopia nie zawiera tych uprawnień.');
      const foreignChildren = await tx.folder.count({ where: { ownerId: { not: ownerId }, parent: { ownerId } } });
      if (foreignChildren) throw new Error('Nie można przywrócić kopii: kartoteki innych użytkowników są podłączone do Twoich kartotek.');
      const otherFolders = new Set((await tx.folder.findMany({ where: { ownerId: { not: ownerId } }, select: { id: true } })).map(folder => folder.id));
      const otherDocuments = new Set((await tx.document.findMany({ where: { folder: { ownerId: { not: ownerId } } }, select: { id: true } })).map(document => document.id));
      // Assign collision-free IDs above every reserved ID, even when restoring
      // another account's archive into a database with overlapping IDs.
      let nextFolderId = [...otherFolders, ...manifest.folders.map(folder => folder.id)].reduce((max, id) => Math.max(max, id), 0) + 1;
      let nextDocumentId = [...otherDocuments, ...manifest.documents.map(document => document.id)].reduce((max, id) => Math.max(max, id), 0) + 1;
      await tx.document.deleteMany({ where: { folder: { ownerId } } });
      await tx.folder.deleteMany({ where: { ownerId } });
      const pending = [...manifest.folders];
      while (pending.length) {
        const index = pending.findIndex(folder => !folder.parentId || folderMap.has(folder.parentId));
        if (index < 0) throw new Error('Nieprawidłowa hierarchia kartotek.');
        const source = pending.splice(index, 1)[0];
        const created = await tx.folder.create({ data: { id: otherFolders.has(source.id) ? nextFolderId++ : source.id, name: source.name.slice(0, 255), parentId: source.parentId ? folderMap.get(source.parentId)! : null, ownerId, order: Number(source.order) || 0, createdAt: parseDate(source.createdAt) } });
        folderMap.set(source.id, created.id);
      }
      for (const source of manifest.documents) {
        const entry = zip.getEntry(`files/${source.id}-${path.basename(source.filePath)}`)!;
        const filename = `${crypto.randomUUID()}-${path.basename(source.filePath)}`;
        const filepath = path.join(targetDir, filename);
        fs.writeFileSync(filepath, entry.getData(), { flag: 'wx' });
        writtenFiles.push(filepath);
        const amountCents = typeof source.amountCents === 'number' && Number.isFinite(source.amountCents) ? Math.round(source.amountCents) : null;
        const created = await tx.document.create({
          data: {
            id: otherDocuments.has(source.id) ? nextDocumentId++ : source.id,
            title: source.title.slice(0, 255),
            filePath: filename,
            mimeType: String(source.mimeType || 'application/octet-stream'),
            folderId: folderMap.get(source.folderId)!,
            userId,
            retentionEnabled: source.retentionEnabled !== false,
            retentionValue: Number(source.retentionValue) || 5,
            retentionUnit: String(source.retentionUnit || 'years'),
            isArchived: Boolean(source.isArchived),
            isDeleted: Boolean(source.isDeleted),
            deletedAt: source.isDeleted ? (parseDate(source.deletedAt) || new Date()) : null,
            createdAt: parseDate(source.createdAt),
            physicalLocation: source.physicalLocation ?? null,
            thumbnail: source.thumbnail ?? null,
            ocrText: typeof source.ocrText === 'string' ? source.ocrText : null,
            merchantName: typeof source.merchantName === 'string' ? source.merchantName.slice(0, 160) : null,
            amountCents,
            currency: typeof source.currency === 'string' && source.currency.trim() ? source.currency.trim().slice(0, 12) : 'PLN',
            dueDate: parseDate(source.dueDate) ?? null,
            paymentStatus: typeof source.paymentStatus === 'string' ? source.paymentStatus.slice(0, 32) : null,
          },
        });
        if (Array.isArray(source.lineItems) && source.lineItems.length > 0) {
          const validItems = source.lineItems
            .filter(item => item && typeof item.name === 'string' && item.name.trim() && typeof item.totalCents === 'number' && Number.isFinite(item.totalCents))
            .map(item => ({
              documentId: created.id,
              name: item.name.trim().slice(0, 200),
              quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
              totalCents: Math.round(item.totalCents),
              category: typeof item.category === 'string' && item.category.trim() ? item.category.trim().slice(0, 80) : 'Inne',
            }));
          if (validItems.length > 0) await tx.documentLineItem.createMany({ data: validItems });
        }
        for (const tag of source.tags || []) {
          const name = String(tag.name || 'tag').slice(0, 80);
          const record = await tx.tag.upsert({ where: { name }, create: { name, color: String(tag.color || '#2563eb') }, update: {} });
          await tx.$executeRaw`INSERT OR IGNORE INTO PlanTagOwner(ownerId, tagId) VALUES (${ownerId}, ${record.id})`;
          await tx.documentTag.create({ data: { documentId: created.id, tagId: record.id } });
        }
      }
    }, { timeout: 120_000 });
  } catch (error) {
    for (const filepath of writtenFiles) { try { fs.unlinkSync(filepath); } catch { /* keep the original failure */ } }
    throw error;
  }
  return { restoredFolders: manifest.folders.length, restoredDocuments: manifest.documents.length };
}
