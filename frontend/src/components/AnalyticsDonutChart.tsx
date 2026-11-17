type StructureSlice = { folderId: number; name: string; count: number; percent: number };

const SLICE_COLORS = ['#06b6d4', '#38bdf8', '#2563eb', '#6366f1', '#8b5cf6'];

/** Displays an SVG donut chart breaking down documents by top-level folder category. */
export default function AnalyticsDonutChart({
  items,
  totalCount,
}: {
  items: StructureSlice[];
  totalCount: number;
}) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <section className="cyber-card flex flex-col rounded-xl border border-slate-700 bg-[#1e293b] p-5">
      <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-300">Struktura Twoich dokumentów</h3>
      {items.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">Brak dokumentów do analizy.</p>
      ) : (
        <div className="flex flex-1 flex-wrap items-center justify-center gap-6">
          <div className="relative h-40 w-40 shrink-0">
            <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
              <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(148,163,184,0.18)" strokeWidth="22" />
              {items.map((item, idx) => {
                const dash = (item.percent / 100) * circumference;
                const offset = -accumulated;
                accumulated += dash;
                return (
                  <circle
                    key={`${item.folderId}-${item.name}`}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={SLICE_COLORS[idx % SLICE_COLORS.length]}
                    strokeWidth="22"
                    strokeDasharray={`${dash} ${circumference}`}
                    strokeDashoffset={offset}
                  />
                );
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-bold text-white">{totalCount}</span>
              <span className="text-[10px] uppercase tracking-wider text-slate-400">plików</span>
            </div>
          </div>

          <ul className="min-w-[160px] flex-1 space-y-2.5 text-sm">
            {items.map((item, idx) => (
              <li key={`${item.folderId}-${item.name}`} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 truncate text-slate-200">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLICE_COLORS[idx % SLICE_COLORS.length] }} />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-slate-400">{item.percent}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
