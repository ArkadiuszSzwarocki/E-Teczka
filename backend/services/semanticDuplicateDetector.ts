import type { PrismaClient } from '@prisma/client';
import { getAccessibleFolderIds } from './familyAccess';

export type SemanticDuplicateWarning = {
  merchantName: string;
  amountCents: number;
  currency: string;
  firstDocId: number;
  firstTitle: string;
  firstDate: string;
  secondDocId: number;
  secondTitle: string;
  secondDate: string;
  reason: string;
};

const THREE_DAYS_MS = 3 * 86_400_000;

/**
 * Detects potential duplicate invoices / double payments across different file formats
 * (e.g. same invoice arriving once as email PDF and once as KSeF XML) using merchant + amount within ±3 days.
 */
export async function detectPotentialDuplicatePayments(
  prisma: PrismaClient,
  ownerId: number,
): Promise<SemanticDuplicateWarning[]> {
  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  const docs = await prisma.document.findMany({
    where: {
      isDeleted: false,
      merchantName: { not: null },
      amountCents: { gt: 0 },
      OR: [{ userId: ownerId }, { folderId: { in: accessibleIds } }],
    },
    select: { id: true, title: true, merchantName: true, amountCents: true, currency: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  const byKey = new Map<string, typeof docs>();
  for (const doc of docs) {
    const key = `${(doc.merchantName || '').trim().toLowerCase()}|${doc.amountCents}|${(doc.currency || 'PLN').toUpperCase()}`;
    const list = byKey.get(key) || [];
    list.push(doc);
    byKey.set(key, list);
  }

  const warnings: SemanticDuplicateWarning[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length - 1; i++) {
      const newer = list[i];
      const older = list[i + 1];
      const diffMs = Math.abs(newer.createdAt.getTime() - older.createdAt.getTime());
      if (diffMs <= THREE_DAYS_MS) {
        warnings.push({
          merchantName: newer.merchantName!.trim(),
          amountCents: Number(newer.amountCents || 0),
          currency: newer.currency || 'PLN',
          firstDocId: older.id,
          firstTitle: older.title,
          firstDate: older.createdAt.toISOString().slice(0, 10),
          secondDocId: newer.id,
          secondTitle: newer.title,
          secondDate: newer.createdAt.toISOString().slice(0, 10),
          reason: 'Ten sam sprzedawca i identyczna kwota w odstępie ≤ 3 dni — sprawdź, aby nie zapłacić dwa razy.',
        });
        break;
      }
    }
  }

  return warnings.slice(0, 10);
}
