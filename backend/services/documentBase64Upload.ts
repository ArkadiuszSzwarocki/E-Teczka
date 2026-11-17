import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { errorMessage } from '../utils/errors';
import { parseBase64DataUrl } from './base64DataUrl';
import { assertUniqueDocument, DuplicateDocumentError, hashBuffer } from './duplicateDocuments';
import { mergeDocuments } from './mergeDocuments';
import { checkDocumentCapacity, consumeUsage, ensurePlanLedger, type getPlan } from './planLedger';

type PlanId = Awaited<ReturnType<typeof getPlan>>;

export type Base64UploadFile = { name: string; data: string; thumbnail?: string | null };
export type RetentionInput = { enabled?: boolean; value?: number; unit?: string };

/** Merges multiple uploaded files into one PDF document and persists it atomically. */
export async function saveMergedBase64Document(
  prisma: PrismaClient,
  params: {
    owner: number;
    userId: number | null;
    ownerKey: string;
    plan: PlanId;
    folderId: number;
    title: string;
    physicalLocation: string | null;
    files: Base64UploadFile[];
    retention: { enabled: boolean; value: number; unit: string };
  },
) {
  await ensurePlanLedger(prisma);
  const merged = await mergeDocuments(params.files);
  const filename = `${Date.now()}-${randomUUID()}.pdf`;
  const destination = path.join(uploadsDir, filename);
  fs.writeFileSync(destination, merged, { flag: 'wx' });
  try {
    return await prisma.$transaction(async tx => {
      await assertUniqueDocument(tx, params.owner, params.folderId, hashBuffer(merged));
      await checkDocumentCapacity(tx, params.owner, params.plan, 1);
      await consumeUsage(tx, params.ownerKey, params.plan, 'merge', randomUUID(), 1);
      return tx.document.create({
        data: {
          title: params.title,
          filePath: filename,
          mimeType: 'application/pdf',
          folderId: params.folderId,
          physicalLocation: params.physicalLocation,
          retentionEnabled: params.retention.enabled,
          retentionValue: params.retention.value,
          retentionUnit: params.retention.unit,
          userId: params.userId,
        },
      });
    });
  } catch (error) {
    fs.unlinkSync(destination);
    throw error;
  }
}

/** Saves a batch of base64 files, skipping duplicates and rolling back written files on failure. */
export async function saveBatchBase64Documents(
  prisma: PrismaClient,
  params: {
    owner: number;
    userId: number | null;
    plan: PlanId;
    folderId: number;
    physicalLocation: string | null;
    files: Base64UploadFile[];
    retentions: RetentionInput[];
  },
) {
  const writtenFiles: string[] = [];
  const skippedDuplicates: Array<{ name: string; existingTitle: string }> = [];
  const prepared = params.files.map((file, i) => {
    const retention = params.retentions[i] || {};
    const retentionEnabled = retention.enabled !== false;
    const retentionValue = Number(retention.value) || 5;
    const retentionUnit = ['years', 'months', 'days', 'minutes'].includes(String(retention.unit)) ? String(retention.unit) : 'years';
    const decoded = parseBase64DataUrl(file.data);
    if (!decoded) throw new Error('Nieprawidłowe dane pliku.');
    const content = Buffer.from(decoded.base64, 'base64');
    return {
      file,
      retentionEnabled,
      retentionValue,
      retentionUnit,
      mimeType: decoded.mimeType,
      content,
      digest: hashBuffer(content),
    };
  });
  try {
    const savedDocs = await prisma.$transaction(async tx => {
      const documents = [];
      for (const item of prepared) {
        const { file, retentionEnabled, retentionValue, retentionUnit, mimeType, content, digest } = item;
        try { await assertUniqueDocument(tx, params.owner, params.folderId, digest); }
        catch (error) {
          if (error instanceof DuplicateDocumentError) {
            skippedDuplicates.push({ name: file.name, existingTitle: error.existingTitle });
            continue;
          }
          throw error;
        }
        await checkDocumentCapacity(tx, params.owner, params.plan, 1);
        const extension = path.extname(file.name).toLowerCase();
        const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
        const filename = `${randomUUID()}${safeExtension}`;
        const destination = path.join(uploadsDir, filename);
        fs.writeFileSync(destination, content, { flag: 'wx' });
        writtenFiles.push(destination);
        documents.push(await tx.document.create({
          data: {
            title: file.name,
            filePath: filename,
            mimeType,
            folderId: params.folderId,
            physicalLocation: params.physicalLocation,
            retentionEnabled,
            retentionValue,
            retentionUnit,
            thumbnail: file.thumbnail || null,
            userId: params.userId,
          },
        }));
      }
      return documents;
    }, { maxWait: 15_000, timeout: 60_000 });
    return { savedDocs, skippedDuplicates };
  } catch (error) {
    for (const destination of writtenFiles) {
      try { fs.unlinkSync(destination); }
      catch (cleanupError) { console.error('[upload] Nie udało się usunąć pliku po błędzie zapisu:', errorMessage(cleanupError)); }
    }
    throw error;
  }
}
