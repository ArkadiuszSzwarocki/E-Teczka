import type { PrismaClient } from '@prisma/client';
import { getAccessibleFolderIds } from './familyAccess';

export type PricePoint = {
  date: string;
  store: string;
  unitPricePln: number;
  totalPln: number;
  quantity: number;
  itemName: string;
};

export type StorePriceComparison = {
  store: string;
  avgUnitPricePln: number;
  minUnitPricePln: number;
  maxUnitPricePln: number;
  samples: number;
};

export type PriceHistoryResponse = {
  query: string;
  topProducts: Array<{ name: string; count: number }>;
  points: PricePoint[];
  storeComparison: StorePriceComparison[];
  inflationPercent: number | null;
};

/** Computes product unit-price inflation history and store-to-store comparison from DocumentLineItem records. */
export async function getProductPriceHistory(
  prisma: PrismaClient,
  ownerId: number,
  rawQuery = '',
): Promise<PriceHistoryResponse> {
  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  const query = rawQuery.trim().toLowerCase();

  const items = await prisma.documentLineItem.findMany({
    where: {
      document: {
        isDeleted: false,
        OR: [{ userId: ownerId }, { folderId: { in: accessibleIds } }],
      },
    },
    include: {
      document: { select: { createdAt: true, merchantName: true, title: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 5000,
  });

  const freq = new Map<string, { display: string; count: number }>();
  for (const item of items) {
    const clean = item.name.trim();
    if (clean.length < 3) continue;
    const key = clean.toLowerCase();
    const prev = freq.get(key);
    if (prev) prev.count++;
    else freq.set(key, { display: clean, count: 1 });
  }
  const topProducts = [...freq.values()]
    .filter(v => v.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map(v => ({ name: v.display, count: v.count }));

  if (!query) {
    return { query: '', topProducts, points: [], storeComparison: [], inflationPercent: null };
  }

  const matched = items.filter(item => item.name.toLowerCase().includes(query));
  const points: PricePoint[] = matched.map(item => {
    const qty = item.quantity > 0 ? item.quantity : 1;
    const totalPln = Number((item.totalCents / 100).toFixed(2));
    const unitPricePln = Number((totalPln / qty).toFixed(2));
    const date = (item.document.createdAt || item.createdAt).toISOString().slice(0, 10);
    const store = item.document.merchantName?.trim() || 'Inny sklep';
    return { date, store, unitPricePln, totalPln, quantity: qty, itemName: item.name };
  }).sort((a, b) => a.date.localeCompare(b.date));

  const byStore = new Map<string, number[]>();
  for (const pt of points) {
    const arr = byStore.get(pt.store) || [];
    arr.push(pt.unitPricePln);
    byStore.set(pt.store, arr);
  }
  const storeComparison: StorePriceComparison[] = [...byStore.entries()]
    .map(([store, prices]) => ({
      store,
      avgUnitPricePln: Number((prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2)),
      minUnitPricePln: Math.min(...prices),
      maxUnitPricePln: Math.max(...prices),
      samples: prices.length,
    }))
    .sort((a, b) => a.avgUnitPricePln - b.avgUnitPricePln);

  let inflationPercent: number | null = null;
  if (points.length >= 2 && points[0].unitPricePln > 0) {
    const first = points[0].unitPricePln;
    const last = points[points.length - 1].unitPricePln;
    inflationPercent = Number((((last - first) / first) * 100).toFixed(1));
  }

  return { query: rawQuery.trim(), topProducts, points, storeComparison, inflationPercent };
}
