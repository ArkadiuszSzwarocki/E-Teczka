import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { assertUniqueDocument, DuplicateDocumentError, hashBuffer } from './duplicateDocuments';
import { checkDocumentCapacity } from './planLedger';
import type { Plan } from './planPolicy';

const ALLOWED_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export type BinaryUploadFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

export type BinaryRetention = { enabled: boolean; value: number; unit: string };

/** Persists raw binary multipart files directly to disk without Base64/JSON overhead. */
export async function saveBatchBinaryDocuments(
  prisma: PrismaClient,
  input: {
    owner: number;
    userId: number | null;
    plan: Plan;
    folderId: number;
    physicalLocation: string | null;
    files: BinaryUploadFile[];
    retentions: BinaryRetention[];
    thumbnails?: Array<string | null>;
  },
) {
  const savedDocs = [];
  const skippedDuplicates: Array<{ name: string; existingTitle: string }> = [];

  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i];
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new Error(`Nieobsługiwany typ pliku: ${file.mimetype}`);
    }
    const ext = EXT_MAP[file.mimetype] || '.bin';
    const fileName = `DOC_${Date.now()}_${randomUUID()}${ext}`;
    const fullPath = path.join(uploadsDir, fileName);
    const digest = hashBuffer(file.buffer);

    const retention = input.retentions[i] || { enabled: false, value: 5, unit: 'years' };
    const rawThumb = input.thumbnails?.[i];
    const thumbnail = typeof rawThumb === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(rawThumb) && rawThumb.length <= 300_000 ? rawThumb : null;

    fs.writeFileSync(fullPath, file.buffer);
    try {
      const saved = await prisma.$transaction(async tx => {
        await assertUniqueDocument(tx, input.owner, input.folderId, digest);
        await checkDocumentCapacity(tx, input.owner, input.plan, 1);
        return tx.document.create({
          data: {
            title: file.originalname.slice(0, 255) || fileName,
            filePath: fileName,
            mimeType: file.mimetype,
            folderId: input.folderId,
            userId: input.userId,
            physicalLocation: input.physicalLocation || null,
            retentionEnabled: Boolean(retention.enabled),
            retentionValue: Number(retention.value) || 5,
            retentionUnit: String(retention.unit || 'years'),
            thumbnail,
          },
        });
      });
      savedDocs.push(saved);
    } catch (error) {
      fs.rmSync(fullPath, { force: true });
      if (error instanceof DuplicateDocumentError && input.files.length > 1) {
        skippedDuplicates.push({ name: file.originalname, existingTitle: error.existingTitle });
        continue;
      }
      throw error;
    }
  }

  return { savedDocs, skippedDuplicates };
}
