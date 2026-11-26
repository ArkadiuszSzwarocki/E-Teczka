import type { PrismaClient } from '@prisma/client';
import { safeReadOcrText } from './ocrText';

type OwnerIndex = {
  count: number;
  entries: Map<number, string>;
};

const ownerCache = new Map<number, OwnerIndex>();

/** Updates a single document's normalized OCR text in the in-memory search index. */
export function indexDocumentOcrText(ownerId: number, documentId: number, plainText: string) {
  const index = ownerCache.get(ownerId);
  if (!index) return;
  index.entries.set(documentId, plainText.toLocaleLowerCase('pl'));
  index.count = index.entries.size;
}

/** Searches decrypted OCR text using a per-owner cached index, avoiding repeated AES decryption on every keystroke. */
export async function searchEncryptedOcrDocuments(prisma: PrismaClient, ownerId: number, query: string): Promise<number[]> {
  const normalized = query.trim().toLocaleLowerCase('pl');
  if (!normalized) return [];

  const totalWithOcr = await prisma.document.count({
    where: { folder: { ownerId }, ocrText: { not: null } },
  });

  let index = ownerCache.get(ownerId);
  if (!index || index.count !== totalWithOcr) {
    const docs = await prisma.document.findMany({
      where: { folder: { ownerId }, ocrText: { not: null } },
      select: { id: true, ocrText: true },
    });
    const entries = new Map<number, string>();
    for (const doc of docs) {
      entries.set(doc.id, safeReadOcrText(doc.ocrText).toLocaleLowerCase('pl'));
    }
    index = { count: totalWithOcr, entries };
    ownerCache.set(ownerId, index);
  }

  const ids: number[] = [];
  for (const [docId, text] of index.entries) {
    if (text.includes(normalized)) ids.push(docId);
  }
  return ids;
}
