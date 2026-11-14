import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import { ocrOwnerKey, hasOcrPremium } from './ocrPremium';
import type { createOcrQueue } from './ocrQueue';

export async function enqueuePremiumOcr(prisma: PrismaClient, queue: ReturnType<typeof createOcrQueue> | undefined, res: express.Response, documentId: number) {
  if (!queue) return;
  try {
    if (!await hasOcrPremium(prisma, res, true)) return;
    const ownerId = Number(res.locals.userId || 1);
    if (!await prisma.document.findFirst({ where: { id: documentId, folder: { ownerId } }, select: { id: true } })) return;
    queue.enqueue(documentId, ocrOwnerKey(res));
  } catch { console.error('[ocr] Nie udało się dodać dokumentu do kolejki.'); }
}
