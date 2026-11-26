import type { PrismaClient } from '@prisma/client';
import { getAccessibleFolderIds } from './familyAccess';
import { safeReadOcrText } from './ocrText';
import { extractFinanceFromOcr } from './financeOcrParser';
import { extractExpiryFromOcr } from './expiryOcrExtractor';

export type ExpiryBackfillResult = {
  scanned: number;
  updated: number;
};

/** Scans existing non-deleted documents without dueDate and populates detected dates from saved OCR text. */
export async function backfillDocumentExpiriesFromOcr(
  prisma: PrismaClient,
  ownerId: number,
): Promise<ExpiryBackfillResult> {
  const folderIds = await getAccessibleFolderIds(prisma, ownerId);
  if (folderIds.length === 0) return { scanned: 0, updated: 0 };

  const candidates = await prisma.document.findMany({
    where: {
      folderId: { in: folderIds },
      isDeleted: false,
      isArchived: false,
      dueDate: null,
      ocrText: { not: null },
    },
    select: { id: true, title: true, ocrText: true },
    take: 500,
  });

  let updated = 0;
  for (const doc of candidates) {
    const plain = safeReadOcrText(doc.ocrText);
    if (!plain.trim()) continue;
    const finance = extractFinanceFromOcr(plain, doc.title);
    const expiry = extractExpiryFromOcr(plain, doc.title);
    const detectedDate = finance.dueDate ?? expiry?.expiryDate ?? null;
    if (!detectedDate || Number.isNaN(detectedDate.getTime())) continue;
    await prisma.document.update({
      where: { id: doc.id },
      data: { dueDate: detectedDate },
    });
    updated += 1;
  }

  return { scanned: candidates.length, updated };
}
