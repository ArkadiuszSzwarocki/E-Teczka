import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { assertUniqueDocument, DuplicateDocumentError, hashBuffer } from './duplicateDocuments';
import { checkDocumentCapacity } from './planLedger';
import type { Plan } from './planPolicy';
import { parseKsefXml } from './ksefXmlParser';
import { parseEReceiptPayload } from './eReceiptParser';
import { protectOcrText } from './ocrText';

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/xml',
  'text/xml',
  'application/json',
]);
const EXT_MAP: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/xml': '.xml',
  'text/xml': '.xml',
  'application/json': '.json',
};

function resolveUploadMime(file: BinaryUploadFile): string {
  if (ALLOWED_MIMES.has(file.mimetype)) return file.mimetype;
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.xml') return 'application/xml';
  if (ext === '.json') return 'application/json';
  return file.mimetype;
}

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
    const mimeType = resolveUploadMime(file);
    if (!ALLOWED_MIMES.has(mimeType)) {
      throw new Error(`Nieobsługiwany typ pliku: ${file.mimetype}`);
    }
    const ext = EXT_MAP[mimeType] || '.bin';
    const fileName = `DOC_${Date.now()}_${randomUUID()}${ext}`;
    const fullPath = path.join(uploadsDir, fileName);
    const digest = hashBuffer(file.buffer);

    const isBusinessPlan = input.plan === 'business';
    const isPremiumTier = input.plan === 'premium' || input.plan === 'family' || input.plan === 'business';
    const ksef = ext === '.xml' && isBusinessPlan ? parseKsefXml(file.buffer.toString('utf8')) : null;
    const eReceipt = ext === '.json' && isPremiumTier ? parseEReceiptPayload(file.buffer.toString('utf8')) : null;
    const structuredItems = ksef?.items ?? eReceipt?.items ?? [];

    const retention = input.retentions[i] || { enabled: false, value: 5, unit: 'years' };
    const effectiveRetentionEnabled = Boolean(retention.enabled) || Boolean(!retention.enabled && eReceipt?.suggestWarrantyYears);
    const effectiveRetentionValue = retention.enabled ? (Number(retention.value) || 5) : (eReceipt?.suggestWarrantyYears || Number(retention.value) || 5);
    const effectiveRetentionUnit = retention.enabled ? String(retention.unit || 'years') : (eReceipt?.suggestWarrantyYears ? 'years' : String(retention.unit || 'years'));

    const rawThumb = input.thumbnails?.[i];
    const thumbnail = typeof rawThumb === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(rawThumb) && rawThumb.length <= 300_000 ? rawThumb : null;

    fs.writeFileSync(fullPath, file.buffer);
    try {
      const saved = await prisma.$transaction(async tx => {
        await assertUniqueDocument(tx, input.owner, input.folderId, digest);
        await checkDocumentCapacity(tx, input.owner, input.plan, 1);
        const created = await tx.document.create({
          data: {
            title: file.originalname.slice(0, 255) || fileName,
            filePath: fileName,
            mimeType,
            folderId: input.folderId,
            userId: input.userId,
            physicalLocation: input.physicalLocation || null,
            retentionEnabled: effectiveRetentionEnabled,
            retentionValue: effectiveRetentionValue,
            retentionUnit: effectiveRetentionUnit,
            thumbnail,
            merchantName: ksef?.merchantName ?? eReceipt?.merchantName ?? null,
            amountCents: ksef?.amountCents ?? eReceipt?.amountCents ?? null,
            currency: ksef?.currency ?? eReceipt?.currency ?? 'PLN',
            dueDate: ksef?.dueDate ?? null,
            paymentStatus: ksef ? ksef.paymentStatus : eReceipt ? 'paid' : null,
            ocrText: ksef ? protectOcrText(ksef.summaryText) : eReceipt ? protectOcrText(eReceipt.summaryText) : null,
          },
        });
        if (structuredItems.length > 0) {
          await tx.documentLineItem.createMany({
            data: structuredItems.map(item => ({
              documentId: created.id,
              name: item.name,
              quantity: item.quantity,
              totalCents: item.totalCents,
              category: item.category,
            })),
          });
        }
        return created;
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
