type FileLocations = {
  foldersCount: number;
  archiveCount: number;
  trashCount: number;
  totalCount: number;
  byFolder: Array<{ folderId: number; name: string; count: number }>;
};

/** Displays where documents are stored across active folders, archive, and trash, plus the total count. */
export default function AnalyticsFileLocationsCard({ fileLocations }: { fileLocations?: FileLocations }) {
  if (!fileLocations) return null;

  return (
    <section className="cyber-card rounded-xl border border-slate-700 bg-[#1e293b] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Rozmieszczenie plików w bazie</h3>
          <p className="mt-0.5 text-xs text-slate-400">Liczba dokumentów w kartotekach, archiwum i koszu</p>
        </div>
        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-300">
          Kartoteki: {fileLocations.foldersCount} · Archiwum: {fileLocations.archiveCount} · Kosz: {fileLocations.trashCount}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-700/80 bg-[#0f172a]/70 p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>Pliki w kartotekach (aktywne)</span>
            <span className="text-white">{fileLocations.foldersCount}</span>
          </div>
          {fileLocations.byFolder.length === 0 ? (
            <p className="py-2 text-xs text-slate-500">Brak aktywnych plików w kartotekach.</p>
          ) : (
            <ul className="divide-y divide-slate-800/80 text-sm">
              {fileLocations.byFolder.map(item => (
                <li key={item.folderId} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-slate-200">📁 {item.name}</span>
                  <span className="shrink-0 font-semibold text-cyan-300">{item.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-700/80 bg-[#0f172a]/70 p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">🗄️ Archiwum</span>
              <span className="font-bold text-amber-300">{fileLocations.archiveCount}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-300">🗑️ Kosz</span>
              <span className="font-bold text-rose-300">{fileLocations.trashCount}</span>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Kosz i archiwum również wliczają się do limitu dokumentów w planie.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-700 pt-3">
        <span className="text-sm font-semibold text-slate-200">Podsumowanie — łączna liczba plików w bazie (kartoteki + archiwum + kosz)</span>
        <span className="text-xl font-bold text-white">
          {fileLocations.totalCount} <span className="text-xs font-normal text-slate-400">plików</span>
        </span>
      </div>
    </section>
  );
}
