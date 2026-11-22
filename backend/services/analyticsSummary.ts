import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { securityDir } from '../config/paths';
import { createFolderVaultStore } from './folderVault';
import { readOcrText } from './ocrText';
import { parseReceiptFromOcr } from './receiptOcrParser';
import { getAccessibleFolderIds } from './familyAccess';

const MONTH_LABELS_PL = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'];
const checkedNonReceiptBackfillIds = new Set<number>();

function computeRetentionExpiry(createdAt: Date, value: number, unit: string): Date | null {
  const expiry = new Date(createdAt);
  if (unit === 'years') expiry.setFullYear(expiry.getFullYear() + value);
  else if (unit === 'months') expiry.setMonth(expiry.getMonth() + value);
  else if (unit === 'days') expiry.setDate(expiry.getDate() + value);
  else if (unit === 'minutes') expiry.setMinutes(expiry.getMinutes() + value);
  else return null;
  return expiry;
}

/** Computes real financial, storage, security, and deadline analytics for the dashboard. */
export async function buildAnalyticsSummary(
  prisma: PrismaClient,
  ownerId: number,
  selectedMonth?: string,
  options?: { allowReceiptInvoiceReading?: boolean; receiptReadingTrialEndsAt?: string | null },
) {
  const allowReceiptInvoiceReading = options?.allowReceiptInvoiceReading !== false;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const targetMonth = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth) ? selectedMonth : currentMonthKey;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const vaultStore = createFolderVaultStore(path.join(securityDir, 'folder-vaults.enc'));

  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  const [folders, rawDocuments, trashCount] = await Promise.all([
    prisma.folder.findMany({ where: { id: { in: accessibleIds } }, select: { id: true, name: true, parentId: true } }),
    prisma.document.findMany({
      where: { folderId: { in: accessibleIds }, isDeleted: false },
      select: {
        id: true, title: true, folderId: true, mimeType: true, createdAt: true,
        retentionEnabled: true, retentionValue: true, retentionUnit: true, ocrText: true,
        merchantName: true, amountCents: true, currency: true, dueDate: true, paymentStatus: true, isArchived: true,
        lineItems: { select: { id: true, name: true, quantity: true, totalCents: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.document.count({ where: { folderId: { in: accessibleIds }, isDeleted: true } }),
  ]);

  // Backfill existing OCR-processed receipts that were uploaded before line-item parsing was added.
  const documents = await Promise.all(rawDocuments.map(async doc => {
    if (!allowReceiptInvoiceReading || !doc.ocrText || doc.lineItems.length > 0 || checkedNonReceiptBackfillIds.has(doc.id)) return doc;
    try {
      const parsed = parseReceiptFromOcr(readOcrText(doc.ocrText));
      if (!parsed.isReceipt) {
        if (checkedNonReceiptBackfillIds.size > 5000) checkedNonReceiptBackfillIds.clear();
        checkedNonReceiptBackfillIds.add(doc.id);
        return doc;
      }
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          ...(parsed.merchantName && !doc.merchantName ? { merchantName: parsed.merchantName } : {}),
          ...(doc.amountCents === null && parsed.amountCents !== null ? { amountCents: parsed.amountCents } : {}),
          ...(parsed.paymentStatus && !doc.paymentStatus ? { paymentStatus: parsed.paymentStatus } : {}),
        },
      });
      if (parsed.items.length > 0) {
        await prisma.documentLineItem.createMany({
          data: parsed.items.map(item => ({
            documentId: doc.id,
            name: item.name,
            quantity: item.quantity,
            totalCents: item.totalCents,
            category: item.category,
          })),
        });
      }
      const refreshedItems = parsed.items.length > 0
        ? await prisma.documentLineItem.findMany({ where: { documentId: doc.id }, select: { id: true, name: true, quantity: true, totalCents: true, category: true } })
        : doc.lineItems;
      return {
        ...doc,
        merchantName: doc.merchantName || parsed.merchantName,
        amountCents: doc.amountCents ?? parsed.amountCents,
        paymentStatus: doc.paymentStatus || parsed.paymentStatus,
        lineItems: refreshedItems,
      };
    } catch {
      return doc;
    }
  }));

  const folderMap = new Map(folders.map(f => [f.id, f]));
  const rootFolderOf = (folderId: number): { id: number; name: string } | null => {
    let current = folderMap.get(folderId);
    let guard = 0;
    while (current && current.parentId !== null && guard < 20) {
      current = folderMap.get(current.parentId);
      guard++;
    }
    return current ? { id: current.id, name: current.name } : null;
  };

  const vaultFolderIds = new Set(
    folders.filter(f => vaultStore.status(`${ownerId}:${f.id}`).configured).map(f => f.id),
  );

  let totalCents = 0;
  let paidCents = 0;
  let unpaidCents = 0;
  const monthlyTotals = new Map<string, number>();
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    monthlyTotals.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
  }

  let last30DaysCount = 0;
  let vaultCount = 0;
  const categoryCounts = new Map<string, { folderId: number; name: string; count: number }>();
  const upcomingDeadlines: Array<{
    id: number;
    title: string;
    date: string;
    daysLeft: number;
    amountCents: number | null;
    currency: string;
    paymentStatus: string | null;
    kind: 'payment' | 'retention';
  }> = [];

  for (const doc of documents) {
    if (doc.createdAt >= thirtyDaysAgo) last30DaysCount++;
    if (vaultFolderIds.has(doc.folderId)) vaultCount++;

    const root = rootFolderOf(doc.folderId);
    if (root) {
      const entry = categoryCounts.get(root.name) || { folderId: root.id, name: root.name, count: 0 };
      entry.count++;
      categoryCounts.set(root.name, entry);
    }

    const docCurrency = (doc.currency || 'PLN').toUpperCase();
    const isBillableDoc = Boolean(
      doc.merchantName ||
      doc.lineItems.length > 0 ||
      /\b(paragon|rachunek|faktura|fv)\b/i.test(doc.title),
    );
    if (isBillableDoc && typeof doc.amountCents === 'number' && doc.amountCents !== 0 && docCurrency === 'PLN') {
      const refDate = doc.dueDate || doc.createdAt;
      const docMonthKey = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
      if (docMonthKey === targetMonth) {
        totalCents += doc.amountCents;
        if (doc.paymentStatus === 'paid') paidCents += doc.amountCents;
        else unpaidCents += doc.amountCents;
      }
      if (refDate >= sixMonthsStart && refDate < monthEnd) {
        if (monthlyTotals.has(docMonthKey)) monthlyTotals.set(docMonthKey, (monthlyTotals.get(docMonthKey) || 0) + doc.amountCents);
      }
    }

    if (!doc.isArchived) {
      if (doc.dueDate && doc.paymentStatus !== 'paid') {
        const daysLeft = Math.ceil((doc.dueDate.getTime() - now.getTime()) / 86_400_000);
        if (daysLeft >= -30 && daysLeft <= 90) {
          upcomingDeadlines.push({
            id: doc.id,
            title: doc.title,
            date: doc.dueDate.toISOString(),
            daysLeft,
            amountCents: doc.amountCents,
            currency: doc.currency || 'PLN',
            paymentStatus: doc.paymentStatus,
            kind: 'payment',
          });
        }
      } else if (doc.retentionEnabled) {
        const expiry = computeRetentionExpiry(doc.createdAt, doc.retentionValue, doc.retentionUnit);
        if (expiry) {
          const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
          if (daysLeft >= 0 && daysLeft <= 45) {
            upcomingDeadlines.push({
              id: doc.id,
              title: doc.title,
              date: expiry.toISOString(),
              daysLeft,
              amountCents: doc.amountCents,
              currency: doc.currency || 'PLN',
              paymentStatus: doc.paymentStatus,
              kind: 'retention',
            });
          }
        }
      }
    }
  }

  upcomingDeadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  const monthlyExpenses = Array.from(monthlyTotals.entries()).map(([key, cents]) => {
    const [, monthStr] = key.split('-');
    return { monthKey: key, label: MONTH_LABELS_PL[Number(monthStr) - 1] || key, totalCents: cents };
  });

  const activeTotal = documents.length || 1;
  const sortedCategories = Array.from(categoryCounts.values()).sort((a, b) => b.count - a.count);
  const topFour = sortedCategories.slice(0, 4).map(c => ({ ...c, percent: Math.round((c.count / activeTotal) * 100) }));
  const restCount = sortedCategories.slice(4).reduce((sum, c) => sum + c.count, 0);
  if (restCount > 0) topFour.push({ folderId: 0, name: 'Inne', count: restCount, percent: Math.round((restCount / activeTotal) * 100) });

  const merchantMap = new Map<string, { name: string; totalCents: number; receiptCount: number; itemCount: number }>();
  const itemCategoryMap = new Map<string, { category: string; totalCents: number; itemCount: number }>();
  const receiptItems: Array<{
    id: number;
    documentId: number;
    documentTitle: string;
    merchantName: string;
    name: string;
    quantity: number;
    totalCents: number;
    category: string;
    date: string;
  }> = [];

  for (const doc of documents) {
    const refDate = doc.dueDate || doc.createdAt;
    const docMonth = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
    if (docMonth !== targetMonth) continue;
    const isExplicitReceiptOrInvoice = Boolean(
      doc.merchantName ||
      doc.lineItems.length > 0 ||
      /\b(paragon|rachunek|faktura|fv)\b/i.test(doc.title)
    );
    if (!isExplicitReceiptOrInvoice) continue;
    if (!doc.merchantName && doc.lineItems.length === 0 && !(typeof doc.amountCents === 'number' && doc.amountCents > 0)) continue;

    const docTotal = doc.amountCents ?? doc.lineItems.reduce((sum, i) => sum + i.totalCents, 0);
    if (docTotal <= 0 && doc.lineItems.length === 0) continue;
    const store = doc.merchantName || 'Inny sklep / rachunek';
    const mEntry = merchantMap.get(store) || { name: store, totalCents: 0, receiptCount: 0, itemCount: 0 };
    mEntry.totalCents += docTotal;
    mEntry.receiptCount++;
    mEntry.itemCount += doc.lineItems.length || 1;
    merchantMap.set(store, mEntry);

    if (doc.lineItems.length === 0 && docTotal > 0) {
      const cat = 'Rachunki i inne';
      const cEntry = itemCategoryMap.get(cat) || { category: cat, totalCents: 0, itemCount: 0 };
      cEntry.totalCents += docTotal;
      cEntry.itemCount++;
      itemCategoryMap.set(cat, cEntry);
      receiptItems.push({
        id: -doc.id,
        documentId: doc.id,
        documentTitle: doc.title,
        merchantName: store,
        name: doc.title,
        quantity: 1,
        totalCents: docTotal,
        category: cat,
        date: refDate.toISOString(),
      });
    }

    for (const item of doc.lineItems) {
      const cEntry = itemCategoryMap.get(item.category) || { category: item.category, totalCents: 0, itemCount: 0 };
      cEntry.totalCents += item.totalCents;
      cEntry.itemCount++;
      itemCategoryMap.set(item.category, cEntry);
      receiptItems.push({
        id: item.id,
        documentId: doc.id,
        documentTitle: doc.title,
        merchantName: store,
        name: item.name,
        quantity: item.quantity,
        totalCents: item.totalCents,
        category: item.category,
        date: doc.createdAt.toISOString(),
      });
    }
  }

  const folderLabel = (folderId: number): string => {
    const parts: string[] = [];
    let current = folderMap.get(folderId);
    let guard = 0;
    while (current && guard < 20) {
      parts.unshift(current.name);
      current = current.parentId !== null ? folderMap.get(current.parentId) : undefined;
      guard++;
    }
    return parts.join(' / ') || 'Bez kartoteki';
  };

  let archiveCount = 0;
  const activeByFolder = new Map<number, number>();
  for (const doc of documents) {
    if (doc.isArchived) archiveCount++;
    else activeByFolder.set(doc.folderId, (activeByFolder.get(doc.folderId) || 0) + 1);
  }
  const foldersCount = documents.length - archiveCount;
  const byFolder = Array.from(activeByFolder.entries())
    .map(([folderId, count]) => ({ folderId, name: folderLabel(folderId), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pl'));

  return {
    selectedMonth: targetMonth,
    receiptReadingLocked: !allowReceiptInvoiceReading,
    receiptReadingTrialEndsAt: options?.receiptReadingTrialEndsAt ?? null,
    costsThisMonth: allowReceiptInvoiceReading ? { totalCents, paidCents, unpaidCents, currency: 'PLN' } : { totalCents: 0, paidCents: 0, unpaidCents: 0, currency: 'PLN' },
    monthlyExpenses: allowReceiptInvoiceReading ? monthlyExpenses : [],
    documentStats: { last30DaysCount, totalCount: documents.length },
    fileLocations: {
      foldersCount,
      archiveCount,
      trashCount,
      totalCount: documents.length + trashCount,
      byFolder,
    },
    vaultCount,
    structure: topFour,
    upcomingDeadlines: upcomingDeadlines.slice(0, 8),
    recentDocuments: documents.slice(0, 6).map(d => ({
      id: d.id,
      title: d.title,
      createdAt: d.createdAt.toISOString(),
      mimeType: d.mimeType,
      folderId: d.folderId,
      amountCents: allowReceiptInvoiceReading ? d.amountCents : null,
      currency: d.currency,
    })),
    receiptMerchants: allowReceiptInvoiceReading ? Array.from(merchantMap.values()).sort((a, b) => b.totalCents - a.totalCents) : [],
    receiptCategories: allowReceiptInvoiceReading ? Array.from(itemCategoryMap.values()).sort((a, b) => b.totalCents - a.totalCents) : [],
    receiptItems: allowReceiptInvoiceReading ? receiptItems.slice(0, 150) : [],
  };
}
