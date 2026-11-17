type MonthBar = { monthKey: string; label: string; totalCents: number };

function formatPlnShort(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('pl-PL')} PLN`;
}

/** Displays a clickable 6-month bar chart of recognized invoice and receipt expenses. */
export default function AnalyticsBarChart({
  items,
  selectedMonth,
  onSelectMonth,
}: {
  items: MonthBar[];
  selectedMonth: string;
  onSelectMonth: (monthKey: string) => void;
}) {
  const maxCents = Math.max(100_00, ...items.map(i => i.totalCents));

  return (
    <section className="cyber-card flex flex-col rounded-xl border border-slate-700 bg-[#1e293b] p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Historia wydatków i rachunków (6 miesięcy)</h3>
        <span className="text-[11px] text-slate-400">Kliknij słupek, aby zobaczyć szczegóły · maks. {formatPlnShort(maxCents)}</span>
      </div>
      <div className="flex h-48 items-end justify-between gap-3 pt-4">
        {items.map(item => {
          const heightPct = item.totalCents > 0 ? Math.max(10, Math.round((item.totalCents / maxCents) * 100)) : 4;
          const active = item.monthKey === selectedMonth;
          return (
            <button
              key={item.monthKey}
              type="button"
              onClick={() => onSelectMonth(item.monthKey)}
              title={`${item.label}: ${(item.totalCents / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN — kliknij, aby rozwinąć sklepy i artykuły`}
              className={`group flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg p-1 transition ${active ? 'bg-cyan-500/10 ring-1 ring-cyan-400/50' : 'hover:bg-white/5'}`}
            >
              <span className={`text-[10px] font-medium ${active ? 'font-bold text-cyan-300' : 'text-slate-400'}`}>
                {item.totalCents > 0 ? `${(item.totalCents / 100).toFixed(0)}` : '0'}
              </span>
              <div className="flex h-36 w-full items-end justify-center">
                <div
                  style={{ height: `${heightPct}%` }}
                  className={`w-full max-w-[44px] rounded-t-lg transition-all duration-300 ${
                    item.totalCents > 0
                      ? 'bg-gradient-to-t from-blue-600 to-cyan-400 group-hover:brightness-110'
                      : 'bg-slate-700/40'
                  }`}
                />
              </div>
              <span className={`text-[11px] font-bold tracking-wider ${active ? 'text-cyan-300' : 'text-slate-400'}`}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
