import { useEffect, useState } from 'react';

type RecurringBill = {
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

type DuplicateWarning = {
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

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  onOpenDocument: (documentId: number) => void;
};

const fmt = (cents: number, currency = 'PLN') => `${(cents / 100).toFixed(2).replace('.', ',')} ${currency}`;

/** Displays recurring bills with silent price-hike alerts (>15%) and potential duplicate payment warnings. */
export default function RecurringBillsCard({ apiUrl, fetcher, onOpenDocument }: Props) {
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateWarning[]>([]);

  useEffect(() => {
    let active = true;
    void fetcher(`${apiUrl}/api/analytics/recurring-bills`)
      .then(async res => (res.ok ? (await res.json()) as { recurringBills?: RecurringBill[]; duplicateWarnings?: DuplicateWarning[] } : null))
      .then(data => {
        if (!active || !data) return;
        setBills(Array.isArray(data.recurringBills) ? data.recurringBills : []);
        setDuplicates(Array.isArray(data.duplicateWarnings) ? data.duplicateWarnings : []);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [apiUrl, fetcher]);

  if (bills.length === 0 && duplicates.length === 0) return null;

  return (
    <div className="space-y-4">
      {duplicates.length > 0 && (
        <section className="rounded-xl border border-red-500/50 bg-red-950/25 p-4">
          <h3 className="text-sm font-bold text-red-200">⚠️ Detektor podwójnych płatności ({duplicates.length})</h3>
          <p className="mt-0.5 text-xs text-red-200/80">Wykryto dokumenty od tego samego sprzedawcy na identyczną kwotę w krótkim odstępie (np. PDF mailem + KSeF XML).</p>
          <div className="mt-3 space-y-2">
            {duplicates.map(dup => (
              <div key={`${dup.firstDocId}-${dup.secondDocId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-[#0f172a]/80 p-2.5 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white">{dup.merchantName} · <span className="text-red-300">{fmt(dup.amountCents, dup.currency)}</span></p>
                  <p className="text-slate-400">1) {dup.firstTitle} ({dup.firstDate}) · 2) {dup.secondTitle} ({dup.secondDate})</p>
                </div>
                <button type="button" onClick={() => onOpenDocument(dup.secondDocId)} className="rounded-lg bg-red-600/80 px-2.5 py-1 font-bold text-white hover:bg-red-500">
                  Sprawdź
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {bills.length > 0 && (
        <section className="cyber-card rounded-xl border border-slate-700 bg-[#1e293b] p-5">
          <h3 className="text-sm font-bold text-white">💡 Stałe opłaty i wykrywacz „cichych podwyżek”</h3>
          <p className="mt-0.5 text-xs text-slate-400">Porównanie najnowszego rachunku ze średnią z ostatnich 3 okresów. Wzrost powyżej +15% oznaczony żółtym alertem.</p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {bills.map(bill => (
              <button
                key={bill.merchantName}
                type="button"
                onClick={() => onOpenDocument(bill.latestDocumentId)}
                className={`rounded-xl border p-3 text-left transition ${bill.isPriceHike ? 'border-amber-500/60 bg-amber-950/25 hover:border-amber-400' : 'border-slate-700 bg-[#0f172a] hover:border-blue-400/60'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-bold text-white">{bill.merchantName}</p>
                  {bill.isPriceHike && bill.hikePercent !== null && (
                    <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold text-amber-300">
                      ⚠️ +{bill.hikePercent}%
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-extrabold text-blue-200">{fmt(bill.latestAmountCents, bill.currency)}</p>
                <p className="text-[11px] text-slate-400">Śr. wcześniej: {fmt(bill.previousAvgCents, bill.currency)} · {bill.count} rach.</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
