import { useCallback, useEffect, useState } from 'react';
import { patchDocument } from '../services/documentApi';

export type ReceiptMerchantSummary = { name: string; totalCents: number; receiptCount: number; itemCount: number };
export type ReceiptCategorySummary = { category: string; totalCents: number; itemCount: number };
export type ReceiptItemEntry = {
  id: number;
  documentId: number;
  documentTitle: string;
  merchantName: string;
  name: string;
  quantity: number;
  totalCents: number;
  category: string;
  date: string;
};

export type AnalyticsSummary = {
  selectedMonth: string;
  receiptReadingLocked?: boolean;
  receiptReadingTrialEndsAt?: string | null;
  costsThisMonth: { totalCents: number; paidCents: number; unpaidCents: number; currency: string };
  monthlyExpenses: Array<{ monthKey: string; label: string; totalCents: number }>;
  documentStats: { last30DaysCount: number; totalCount: number };
  fileLocations?: {
    foldersCount: number;
    archiveCount: number;
    trashCount: number;
    totalCount: number;
    byFolder: Array<{ folderId: number; name: string; count: number }>;
  };
  vaultCount: number;
  structure: Array<{ folderId: number; name: string; count: number; percent: number }>;
  upcomingDeadlines: Array<{
    id: number;
    title: string;
    date: string;
    daysLeft: number;
    amountCents: number | null;
    currency: string;
    paymentStatus: string | null;
    kind: 'payment' | 'retention';
  }>;
  recentDocuments: Array<{
    id: number;
    title: string;
    createdAt: string;
    mimeType: string;
    folderId: number;
    amountCents: number | null;
    currency: string;
  }>;
  receiptMerchants: ReceiptMerchantSummary[];
  receiptCategories: ReceiptCategorySummary[];
  receiptItems: ReceiptItemEntry[];
};

export type PlanUsageSummary = {
  documents: { used: number; limit: number | null };
};

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Fetches real financial, structure, deadline, receipt, and plan usage analytics for the summary view. */
export function useAnalyticsSummary(apiUrl: string, fetcher: typeof fetch) {
  const [selectedMonth, setSelectedMonth] = useState<string>(currentYearMonth);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [usage, setUsage] = useState<PlanUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sumRes, usageRes] = await Promise.all([
        fetcher(`${apiUrl}/api/analytics/summary?month=${encodeURIComponent(selectedMonth)}`),
        fetcher(`${apiUrl}/api/billing/usage`),
      ]);
      if (!sumRes.ok) throw new Error('Nie udało się pobrać podsumowania.');
      setSummary(await sumRes.json() as AnalyticsSummary);
      if (usageRes.ok) {
        const u = await usageRes.json() as { documents?: { used: number; limit: number | null } };
        if (u?.documents) setUsage({ documents: u.documents });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd wczytywania analiz.');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, fetcher, selectedMonth]);

  useEffect(() => { void load(); }, [load]);

  const markPaymentStatus = async (docId: number, status: 'paid' | 'unpaid') => {
    const res = await patchDocument(apiUrl, fetcher, docId, { paymentStatus: status } as never);
    if (res.ok) await load();
  };

  return {
    selectedMonth,
    setSelectedMonth,
    summary,
    usage,
    loading,
    error,
    reload: load,
    markPaymentStatus,
  };
}
