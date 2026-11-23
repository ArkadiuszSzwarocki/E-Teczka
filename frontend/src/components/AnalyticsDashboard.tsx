import { useState } from 'react';
import sejfIcon from '../assets/folder-icons/sejf.png';
import fakturyIcon from '../assets/folder-icons/faktury.png';
import inboxIcon from '../assets/folder-icons/inbox.png';
import { useAnalyticsSummary } from '../hooks/useAnalyticsSummary';
import AnalyticsBarChart from './AnalyticsBarChart';
import AnalyticsDonutChart from './AnalyticsDonutChart';
import AnalyticsFileLocationsCard from './AnalyticsFileLocationsCard';
import PriceInflationCard from './PriceInflationCard';
import ReceiptInsightsPanel from './ReceiptInsightsPanel';
import RecurringBillsCard from './RecurringBillsCard';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  scannerFileCount: number;
  onOpenScanner: () => void;
  onOpenDocument: (documentId: number) => void;
};

function formatCurrency(cents: number, currency = 'PLN'): string {
  return `${(cents / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function deadlineBadge(daysLeft: number): { label: string; cls: string } {
  if (daysLeft < 0) return { label: `po terminie (${Math.abs(daysLeft)} dni)`, cls: 'bg-red-500/20 text-red-300 border-red-500/40' };
  if (daysLeft === 0) return { label: 'dzisiaj', cls: 'bg-red-500/20 text-red-300 border-red-500/40' };
  if (daysLeft <= 7) return { label: `za ${daysLeft} dni`, cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
  return { label: `za ${daysLeft} dni`, cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
}

/** Command-center analytics view: monthly costs, plan usage, inbox, vault, charts, and deadlines. */
export default function AnalyticsDashboard({
  apiUrl,
  fetcher,
  scannerFileCount,
  onOpenScanner,
  onOpenDocument,
}: Props) {
  const { selectedMonth, setSelectedMonth, summary, usage, loading, error, reload, markPaymentStatus } = useAnalyticsSummary(apiUrl, fetcher);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [accountantLink, setAccountantLink] = useState<{ url: string; pin: string; month: string } | null>(null);

  const shareAccountantPortal = async () => {
    setShareBusy(true);
    setBundleError('');
    try {
      const res = await fetcher(`${apiUrl}/api/analytics/accountant-share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const payload = await res.json().catch(() => ({})) as { url?: string; pin?: string; month?: string; error?: string };
      if (!res.ok || !payload.url || !payload.pin) {
        throw new Error(payload.error || 'Nie udało się wygenerować linku dla księgowej.');
      }
      setAccountantLink({ url: payload.url, pin: payload.pin, month: payload.month || selectedMonth });
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : 'Błąd tworzenia linku dla księgowej.');
    } finally {
      setShareBusy(false);
    }
  };

  const downloadAccountantBundle = async () => {
    setBundleBusy(true);
    setBundleError('');
    try {
      const res = await fetcher(`${apiUrl}/api/automation/accountant-bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || 'Nie udało się wygenerować paczki dla księgowej.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `paczka-ksiegowa-${selectedMonth}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : 'Błąd eksportu paczki ZIP.');
    } finally {
      setBundleBusy(false);
    }
  };

  const focusExpensesMonth = (monthKey?: string) => {
    if (monthKey) setSelectedMonth(monthKey);
    window.setTimeout(() => {
      document.getElementById('receipt-insights-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  if (loading && !summary) {
    return <div className="p-8 text-sm text-slate-400">Wczytywanie podsumowania i analiz…</div>;
  }

  if (error && !summary) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-6 text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (!summary) return null;

  const docLimit = usage?.documents.limit ?? null;
  const docUsed = usage?.documents.used ?? summary.documentStats.totalCount;
  const progressPct = docLimit ? Math.min(100, Math.round((docUsed / docLimit) * 100)) : 100;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Podsumowanie i analizy</h2>
          <p className="text-sm text-slate-400">Analiza kosztów, dokumentów oraz nadchodzących terminów płatności w MojejTeczce</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={bundleBusy} onClick={() => void downloadAccountantBundle()} className="rounded-lg border border-amber-500/60 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50">
            {bundleBusy ? 'Pakowanie ZIP…' : `📦 Paczka dla księgowej (${selectedMonth})`}
          </button>
          <button type="button" disabled={shareBusy} onClick={() => void shareAccountantPortal()} className="rounded-lg border border-indigo-500/60 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50">
            {shareBusy ? 'Tworzenie linku…' : '🔗 Wyślij księgowej (link + PIN)'}
          </button>
          <button type="button" onClick={() => void reload()} className="cyber-btn-secondary rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            ↻ Odśwież dane
          </button>
        </div>
      </div>
      {bundleError && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">{bundleError}</p>}
      {accountantLink && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/50 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-100">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-bold text-emerald-300">🔗 Link dla księgowej ({accountantLink.month}) ważny 7 dni:</p>
            <p className="truncate font-mono text-white">{accountantLink.url}</p>
            <p>Jednorazowy PIN dla księgowej: <strong className="rounded bg-slate-900 px-2 py-0.5 font-mono text-sm text-amber-300">{accountantLink.pin}</strong></p>
          </div>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(`Paczka dokumentów (${accountantLink.month}): ${accountantLink.url}\nPIN: ${accountantLink.pin}`)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
            📋 Kopiuj link i PIN
          </button>
        </div>
      )}

      {summary.receiptReadingLocked && (
        <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          Okres próbny odczytu paragonów i faktur w panelu analiz wygasł{summary.receiptReadingTrialEndsAt ? ` (${new Date(summary.receiptReadingTrialEndsAt).toLocaleDateString('pl-PL')})` : ''}. Przejdź na wyższy plan, aby ponownie wyświetlać podsumowanie wydatków z paragonów i faktur.
        </div>
      )}

      {/* Top KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => focusExpensesMonth()} className="cyber-card flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#1e293b] p-4 text-left hover:border-cyan-400">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Koszty w tym miesiącu</p>
            <p className="mt-1 text-2xl font-bold text-cyan-300">{formatCurrency(summary.costsThisMonth.totalCents, summary.costsThisMonth.currency)}</p>
            <p className="mt-1 text-xs text-rose-300">Do zapłaty: {formatCurrency(summary.costsThisMonth.unpaidCents, summary.costsThisMonth.currency)}</p>
            <p className="text-xs text-emerald-300">Zrealizowane: {formatCurrency(summary.costsThisMonth.paidCents, summary.costsThisMonth.currency)}</p>
          </div>
          <img src={fakturyIcon} alt="" className="h-12 w-12 shrink-0 object-contain" />
        </button>

        <div className="cyber-card flex flex-col justify-between rounded-xl border border-slate-700 bg-[#1e293b] p-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Statystyki dokumentów</p>
            <p className="mt-1 text-sm font-semibold text-white">
              Ostatnie 30 dni: <span className="text-cyan-300">+{summary.documentStats.last30DaysCount}</span> nowych
            </p>
          </div>
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              {docLimit ? `${docUsed} / ${docLimit} dokumentów w planie` : `${docUsed} dokumentów (bez limitu)`}
            </p>
          </div>
        </div>

        <button type="button" onClick={onOpenScanner} className="cyber-card flex items-center justify-between gap-3 rounded-xl border border-amber-500/50 bg-[#1e293b] p-4 text-left hover:border-amber-400">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">Do segregacji (Inbox)</p>
            <p className="mt-1 text-2xl font-bold text-amber-200">{scannerFileCount} plików czeka</p>
            <p className="mt-1 text-xs text-slate-400">Kliknij, aby przypisać do kartotek</p>
          </div>
          <img src={inboxIcon} alt="" className="h-12 w-12 shrink-0 object-contain" />
        </button>

        <div className="cyber-card cyber-card-vault flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-[#1e293b] p-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bezpieczeństwo (Sejf)</p>
            <p className="mt-1 text-2xl font-bold text-rose-300">{summary.vaultCount} dokumenty</p>
            <p className="mt-1 text-xs text-slate-400">chronione w sejfie</p>
          </div>
          <img src={sejfIcon} alt="" className="h-12 w-12 shrink-0 object-contain" />
        </div>
      </div>

      {/* Middle Charts Row */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AnalyticsBarChart items={summary.monthlyExpenses} selectedMonth={selectedMonth} onSelectMonth={focusExpensesMonth} />
        </div>
        <AnalyticsDonutChart items={summary.structure} totalCount={summary.documentStats.totalCount} />
      </div>

      {/* Bottom Row: Deadlines & Recent */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="cyber-card rounded-xl border border-slate-700 bg-[#1e293b] p-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Nadchodzące terminy i płatności</h3>
          {summary.upcomingDeadlines.length === 0 ? (
            <p className="py-6 text-sm text-slate-400">Brak pilnych terminów płatności lub wygaśnięcia dokumentów.</p>
          ) : (
            <div className="divide-y divide-slate-800/80 text-sm">
              {summary.upcomingDeadlines.map(item => {
                const badge = deadlineBadge(item.daysLeft);
                return (
                  <div key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <button type="button" onClick={() => onOpenDocument(item.id)} className="min-w-0 flex-1 truncate text-left font-medium text-white hover:text-cyan-300">
                      {item.title}
                    </button>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">{new Date(item.date).toLocaleDateString('pl-PL')}</span>
                      {typeof item.amountCents === 'number' && (
                        <span className="font-semibold text-amber-300">{formatCurrency(item.amountCents, item.currency)}</span>
                      )}
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.label}</span>
                      {item.kind === 'payment' && item.paymentStatus !== 'paid' && (
                        <button type="button" onClick={() => void markPaymentStatus(item.id, 'paid')} className="rounded bg-emerald-600/80 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-500">
                          Opłać
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="cyber-card rounded-xl border border-slate-700 bg-[#1e293b] p-5">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Ostatnio dodane dokumenty</h3>
          {summary.recentDocuments.length === 0 ? (
            <p className="py-6 text-sm text-slate-400">Brak dodanych dokumentów.</p>
          ) : (
            <div className="divide-y divide-slate-800/80 text-sm">
              {summary.recentDocuments.map(doc => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onOpenDocument(doc.id)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:text-cyan-300"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-white">{doc.title}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {new Date(doc.createdAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <ReceiptInsightsPanel
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        merchants={summary.receiptMerchants}
        categories={summary.receiptCategories}
        items={summary.receiptItems}
        onOpenDocument={onOpenDocument}
      />

      <RecurringBillsCard apiUrl={apiUrl} fetcher={fetcher} onOpenDocument={onOpenDocument} />

      <PriceInflationCard apiUrl={apiUrl} fetcher={fetcher} />

      <AnalyticsFileLocationsCard fileLocations={summary.fileLocations} />
    </div>
  );
}
