import type { PrismaClient } from '@prisma/client';
import { getAccessibleFolderIds } from './familyAccess';

export type RecurringBillItem = {
  merchantName: string;
  count: number;
  latestAmountCents: number;
  previousAvgCents: number;
  currency: string;
  latestDate: string;
  latestDocumentId: number;
  hikePercent: number | null;
  isPriceHike: boolean;
};

/** Detects recurring monthly/quarterly bills per merchant and flags silent price hikes (>15% above prior 3-bill average). */
export async function detectRecurringBillsAndHikes(prisma: PrismaClient, ownerId: number): Promise<RecurringBillItem[]> {
  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  const docs = await prisma.document.findMany({
    where: {
      isDeleted: false,
      merchantName: { not: null },
      amountCents: { gt: 0 },
      OR: [{ userId: ownerId }, { folderId: { in: accessibleIds } }],
    },
    select: { id: true, merchantName: true, amountCents: true, currency: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });

  const grouped = new Map<string, typeof docs>();
  for (const doc of docs) {
    const merchant = (doc.merchantName || '').trim();
    if (merchant.length < 2) continue;
    const key = merchant.toLowerCase();
    const list = grouped.get(key) || [];
    list.push(doc);
    grouped.set(key, list);
  }

  const results: RecurringBillItem[] = [];
  for (const list of grouped.values()) {
    if (list.length < 2) continue;
    const latest = list[0];
    const prior = list.slice(1, 4);
    const prevAvg = Math.round(prior.reduce((sum, d) => sum + Number(d.amountCents || 0), 0) / prior.length);
    const latestAmt = Number(latest.amountCents || 0);
    const hikePercent = prevAvg > 0 ? Number((((latestAmt - prevAvg) / prevAvg) * 100).toFixed(1)) : null;
    results.push({
      merchantName: latest.merchantName!.trim(),
      count: list.length,
      latestAmountCents: latestAmt,
      previousAvgCents: prevAvg,
      currency: latest.currency || 'PLN',
      latestDate: latest.createdAt.toISOString().slice(0, 10),
      latestDocumentId: latest.id,
      hikePercent,
      isPriceHike: hikePercent !== null && hikePercent > 15,
    });
  }

  return results.sort((a, b) => Number(b.isPriceHike) - Number(a.isPriceHike) || b.count - a.count).slice(0, 15);
}
