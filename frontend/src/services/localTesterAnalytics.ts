import type { LocalDatabase } from '../types/localTesterDb';

const MONTH_LABELS = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'];

/** Computes dashboard analytics summary directly from the local tester database. */
export function buildLocalAnalytics(db: LocalDatabase, selectedMonth?: string) {
  const now = new Date();
  const targetMonth = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth)
    ? selectedMonth
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const thirtyDaysAgo = now.getTime() - 30 * 86_400_000;

  const nonDeletedDocs = db.documents
    .filter(d => !d.isDeleted)
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const trashCount = db.documents.length - nonDeletedDocs.length;

  const folderMap = new Map(db.folders.map(f => [f.id, f]));
  const rootFolderOf = (folderId: number): { id: number; name: string } | null => {
    let current = folderMap.get(folderId);
    for (let guard = 0; current && current.parentId !== null && guard < 20; guard++) {
      current = folderMap.get(current.parentId);
    }
    return current ? { id: current.id, name: current.name } : null;
  };
  const folderLabel = (folderId: number): string => {
    const parts: string[] = [];
    let current = folderMap.get(folderId);
    for (let guard = 0; current && guard < 20; guard++) {
      parts.unshift(current.name);
      current = current.parentId !== null ? folderMap.get(current.parentId) : undefined;
    }
    return parts.join(' / ') || 'Bez kartoteki';
  };

  const monthlyTotals = new Map<string, number>();
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    monthlyTotals.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
  }

  let totalCents = 0;
  let paidCents = 0;
  let unpaidCents = 0;
  let last30DaysCount = 0;
  let vaultCount = 0;
  let archiveCount = 0;
  const activeByFolder = new Map<number, number>();
  const categoryCounts = new Map<string, { folderId: number; name: string; count: number }>();

  for (const doc of nonDeletedDocs) {
    if (Date.parse(doc.createdAt) >= thirtyDaysAgo) last30DaysCount++;
    const root = rootFolderOf(doc.folderId);
    if (root) {
      if (root.name.trim().toLowerCase() === 'sejf') vaultCount++;
      const entry = categoryCounts.get(root.name) || { folderId: root.id, name: root.name, count: 0 };
      entry.count++;
      categoryCounts.set(root.name, entry);
    }
    if (doc.isArchived) archiveCount++;
    else activeByFolder.set(doc.folderId, (activeByFolder.get(doc.folderId) || 0) + 1);

    if (typeof doc.amountCents === 'number' && doc.amountCents > 0) {
      const refDate = doc.dueDate ? new Date(doc.dueDate) : new Date(doc.createdAt);
      if (refDate >= monthStart) {
        totalCents += doc.amountCents;
        if (doc.paymentStatus === 'paid') paidCents += doc.amountCents;
        else unpaidCents += doc.amountCents;
      }
      if (refDate >= sixMonthsStart) {
        const key = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyTotals.has(key)) monthlyTotals.set(key, (monthlyTotals.get(key) || 0) + doc.amountCents);
      }
    }
  }

  const totalDocs = nonDeletedDocs.length;
  return {
    selectedMonth: targetMonth,
    receiptReadingLocked: false,
    receiptReadingTrialEndsAt: null,
    costsThisMonth: { totalCents, paidCents, unpaidCents, currency: 'PLN' },
    monthlyExpenses: Array.from(monthlyTotals.entries()).map(([monthKey, cents]) => {
      const [, m] = monthKey.split('-').map(Number);
      return { monthKey, label: MONTH_LABELS[(m - 1) % 12] || monthKey, totalCents: cents };
    }),
    documentStats: { last30DaysCount, totalCount: totalDocs },
    fileLocations: {
      foldersCount: totalDocs - archiveCount,
      archiveCount,
      trashCount,
      totalCount: db.documents.length,
      byFolder: Array.from(activeByFolder.entries())
        .map(([folderId, count]) => ({ folderId, name: folderLabel(folderId), count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl')),
    },
    vaultCount,
    structure: Array.from(categoryCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(item => ({ ...item, percent: totalDocs > 0 ? Math.round((item.count / totalDocs) * 100) : 0 })),
    upcomingDeadlines: [],
    recentDocuments: nonDeletedDocs.slice(0, 6).map(d => ({
      id: d.id, title: d.title, createdAt: d.createdAt, mimeType: d.mimeType,
      folderId: d.folderId, amountCents: d.amountCents, currency: d.currency,
    })),
    receiptMerchants: [],
    receiptCategories: [],
    receiptItems: [],
  };
}
