import { useCallback, useEffect, useState } from 'react';

type PricePoint = { date: string; store: string; unitPricePln: number; totalPln: number; quantity: number; itemName: string };
type StoreComp = { store: string; avgUnitPricePln: number; minUnitPricePln: number; maxUnitPricePln: number; samples: number };
type HistoryPayload = {
  query: string;
  topProducts: Array<{ name: string; count: number }>;
  points: PricePoint[];
  storeComparison: StoreComp[];
  inflationPercent: number | null;
};

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
};

/** Basket Inflation Tracker card showing product unit-price trend over time and store comparison. */
export default function PriceInflationCard({ apiUrl, fetcher }: Props) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetcher(`${apiUrl}/api/analytics/price-history?q=${encodeURIComponent(q)}`);
      if (res.ok) setData((await res.json()) as HistoryPayload);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [apiUrl, fetcher]);

  useEffect(() => { void load(''); }, [load]);

  const maxPrice = data?.points.length ? Math.max(...data.points.map(p => p.unitPricePln), 1) : 1;

  return (
    <section className="cyber-card rounded-xl border border-slate-700 bg-[#1e293b] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">📈 Śledzenie inflacji koszyka</h3>
          <p className="text-xs text-slate-400">Porównuj ceny tych samych produktów z paragonów w czasie oraz między sklepami.</p>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); void load(query); }}
          className="flex items-center gap-2"
        >
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="np. kawa, masło, paliwo…"
            className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
          />
          <button type="submit" disabled={loading} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50">
            Sprawdź
          </button>
        </form>
      </div>

      {data && data.topProducts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.topProducts.map(prod => (
            <button
              key={prod.name}
              type="button"
              onClick={() => { setQuery(prod.name); void load(prod.name); }}
              className="rounded-full border border-slate-600 bg-slate-800/80 px-2.5 py-0.5 text-[11px] font-medium text-slate-200 hover:border-blue-400 hover:text-white"
            >
              {prod.name} ({prod.count})
            </button>
          ))}
        </div>
      )}

      {data?.query && (
        <div className="mt-4 space-y-4">
          {data.points.length === 0 ? (
            <p className="text-xs text-slate-400">Brak pozycji na paragonach pasujących do „{data.query}”.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-300">
                  Znaleziono <strong className="text-white">{data.points.length}</strong> zakupów dla „{data.query}”
                </p>
                {data.inflationPercent !== null && (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${data.inflationPercent > 0 ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                    {data.inflationPercent > 0 ? `+${data.inflationPercent}% drożej` : `${data.inflationPercent}% taniej`}
                  </span>
                )}
              </div>

              <div className="flex h-24 items-end gap-1.5 rounded-lg border border-slate-700 bg-[#0f172a] p-3">
                {data.points.slice(-24).map((pt, idx) => {
                  const pct = Math.max(12, Math.round((pt.unitPricePln / maxPrice) * 100));
                  return (
                    <div key={`${pt.date}-${idx}`} title={`${pt.date} · ${pt.store}: ${pt.unitPricePln.toFixed(2)} zł`} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <div className="w-full rounded-t bg-blue-500/80 transition hover:bg-blue-400" style={{ height: `${pct}%` }} />
                    </div>
                  );
                })}
              </div>

              {data.storeComparison.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {data.storeComparison.map((s, idx) => (
                    <div key={s.store} className={`rounded-lg border p-2.5 text-xs ${idx === 0 ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-slate-700 bg-[#0f172a]'}`}>
                      <p className="truncate font-bold text-white">{idx === 0 ? '🏆 ' : ''}{s.store}</p>
                      <p className="mt-0.5 text-slate-300">Śr. cena: <strong className="text-blue-200">{s.avgUnitPricePln.toFixed(2)} zł</strong></p>
                      <p className="text-[11px] text-slate-400">Zakres: {s.minUnitPricePln.toFixed(2)}–{s.maxUnitPricePln.toFixed(2)} zł ({s.samples}×)</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
