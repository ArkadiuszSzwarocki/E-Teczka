import { formatBytes, type UploadProgress } from '../services/documentUpload';

export default function UploadTransferProgress({ progress, onCancel }: { progress: UploadProgress; onCancel: () => void }) {
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100)) : 0;
  const phaseLabel =
    progress.phase === 'preparing'
      ? 'Przygotowywanie i kompresja plików…'
      : progress.phase === 'uploading'
        ? 'Przesyłanie z komputera do MojejTeczki…'
        : 'Zapisywanie i szyfrowanie w archiwum…';

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="upload-progress-title" className="w-full max-w-lg rounded-2xl border border-blue-500/50 bg-[#0b1324] p-6 shadow-2xl">
        <h2 id="upload-progress-title" className="mb-5 text-center text-lg font-bold text-white">
          Przesyłanie dokumentów
        </h2>

        <div className="mb-5 flex items-center justify-center gap-4">
          <div className="flex flex-col items-center gap-1 text-slate-300">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-600 bg-slate-800 text-3xl">💻</div>
            <span className="text-xs font-semibold text-slate-400">Komputer</span>
          </div>
          <div className="relative flex w-36 items-center justify-center overflow-hidden">
            <div className="h-0.5 w-full bg-slate-700" />
            <div className="absolute flex gap-2 animate-pulse">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-1 text-slate-300">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-blue-500/60 bg-blue-950/60 text-3xl">🗄️</div>
            <span className="text-xs font-semibold text-blue-300">MojaTeczka</span>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold">
          <span className="text-blue-200">{phaseLabel}</span>
          <span className="text-emerald-300">{percent}%</span>
        </div>

        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-150" style={{ width: `${percent}%` }} />
        </div>

        <div className="mt-4 space-y-1.5 rounded-xl border border-slate-700/80 bg-slate-900/70 p-3 text-xs text-slate-300">
          <p className="truncate" title={progress.fileName}>
            Wysyłane: <strong className="text-white">{progress.fileName}</strong>
          </p>
          <p>
            Liczba plików: <strong className="text-white">{progress.phase === 'preparing' ? `${progress.fileIndex} z ${progress.totalFiles}` : `${progress.totalFiles}`}</strong>
            {' · '}
            Waga: <strong className="text-blue-200">{formatBytes(progress.loadedBytes)}</strong> / {formatBytes(progress.totalBytes)}
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onCancel} className="rounded-lg border border-red-500/60 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-900/60">
            Przerwij wysyłanie
          </button>
        </div>
      </section>
    </div>
  );
}
