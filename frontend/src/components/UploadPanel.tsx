import type { ReactNode } from 'react';
import type { RetentionUnit } from '../types/domain';
import { formatBytes, type UploadItem } from '../services/documentUpload';
import type { UploadUsageSummary } from '../hooks/useBatchUpload';
import { AppFolderIcon } from './FolderIconPicker';
import { isMobileBrowser } from '../services/platform';

type Props = {
  uploadUsage: UploadUsageSummary | null;
  uploadDocsExceeded: boolean;
  uploadMergeExceeded: boolean;
  uploadDocsRemaining: number | null;
  uploadMergeRemaining: number | null;
  neededUploadDocs: number;
  folderId: string;
  setFolderId: (id: string) => void;
  folderOptions: ReactNode[];
  physicalLocation: string;
  setPhysicalLocation: (val: string) => void;
  foldersUnavailable: boolean;
  filesToUpload: UploadItem[];
  setFilesToUpload: React.Dispatch<React.SetStateAction<UploadItem[]>>;
  isMergeMode: boolean;
  setIsMergeMode: (val: boolean) => void;
  isUploading: boolean;
  mergedTitle: string;
  setMergedTitle: (val: string) => void;
  mergedRetentionVal: number;
  setMergedRetentionVal: (val: number) => void;
  mergedRetentionUnit: RetentionUnit;
  setMergedRetentionUnit: (val: RetentionUnit) => void;
  mergedRetentionEnabled: boolean;
  setMergedRetentionEnabled: (val: boolean) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onOpenPlans: () => void;
  onRetryFetch: () => void;
  onOpenEReceiptImport?: () => void;
  onOpenIdCardCopy?: () => void;
  onPasteFromClipboard?: () => void;
};

/** Presentational panel for batch document upload, physical location, and PDF merging. */
export default function UploadPanel({
  uploadUsage, uploadDocsExceeded, uploadMergeExceeded, uploadDocsRemaining, uploadMergeRemaining, neededUploadDocs,
  folderId, setFolderId, folderOptions, physicalLocation, setPhysicalLocation, foldersUnavailable,
  filesToUpload, setFilesToUpload, isMergeMode, setIsMergeMode, isUploading,
  mergedTitle, setMergedTitle, mergedRetentionVal, setMergedRetentionVal,
  mergedRetentionUnit, setMergedRetentionUnit, mergedRetentionEnabled, setMergedRetentionEnabled,
  onFileSelect, onSubmit, onOpenPlans, onRetryFetch, onOpenEReceiptImport, onOpenIdCardCopy, onPasteFromClipboard,
}: Props) {
  const isMobile = isMobileBrowser();
  return (
    <div className="mb-10 h-fit w-full max-w-5xl rounded-lg border border-slate-700 bg-[#1e293b] p-4 shadow-xl sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white">📦 Rejestracja Dokumentów</h2>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenIdCardCopy && (
            <button
              type="button"
              onClick={onOpenIdCardCopy}
              className="rounded-lg border border-indigo-500/60 bg-indigo-950/40 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/50"
            >
              🪪 Kopia dowodu (A4 + znak wodny)
            </button>
          )}
          {onOpenEReceiptImport && (
            <button
              type="button"
              onClick={onOpenEReceiptImport}
              className="rounded-lg border border-cyan-500/60 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50"
            >
              📲 Importuj e-Paragon (QR / tekst)
            </button>
          )}
        </div>
      </div>
      {uploadUsage && (
        <div className={`mb-5 rounded-lg border px-4 py-3 text-xs leading-5 ${uploadDocsExceeded || uploadMergeExceeded ? 'border-red-500/60 bg-red-950/35 text-red-200' : 'border-slate-600 bg-[#111827]/80 text-slate-300'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Plan <strong className="text-white">{uploadUsage.plan === 'free' ? 'Darmowy' : uploadUsage.plan === 'standard' ? 'Standard' : uploadUsage.plan === 'family' ? 'Rodzinny' : uploadUsage.plan === 'business' ? 'Firmowy' : 'Premium'}</strong>:{' '}
              {uploadDocsRemaining === null ? 'bez limitu dokumentów' : <>możesz wgrać jeszcze <strong className="text-white">{uploadDocsRemaining}</strong> z {uploadUsage.documents.limit} dokumentów</>}
              {isMergeMode && uploadMergeRemaining !== null && <> · łączenie PDF: pozostało <strong className="text-white">{uploadMergeRemaining}</strong></>}
            </span>
            {(uploadDocsExceeded || uploadMergeExceeded) && (
              <button type="button" onClick={onOpenPlans} className="rounded bg-amber-500 px-2.5 py-1 font-bold text-slate-950 hover:bg-amber-400">
                Zmień plan
              </button>
            )}
          </div>
          {uploadDocsExceeded && <p className="mt-1 font-semibold text-red-300">Wybrano {neededUploadDocs} dokumentów — przekracza to wolne miejsce w planie ({uploadDocsRemaining}). Usuń nadmiarowe pliki albo połącz je w jeden PDF.</p>}
          {uploadMergeExceeded && <p className="mt-1 font-semibold text-red-300">Wykorzystano limit łączenia stron w bieżącym okresie.</p>}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-bold text-slate-200">Docelowa Kartoteka (WYMAGANA)</label>
            <select value={folderId} onChange={e => setFolderId(e.target.value)} className="w-full appearance-none rounded-md border border-slate-600 bg-[#111827] p-2.5 font-medium text-white focus:border-blue-500 focus:outline-none">
              <option value="">-- Wybierz kartotekę --</option>
              {folderOptions.length ? folderOptions : <option disabled>Brak kartotek — utwórz kartotekę w widoku Kartoteki</option>}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label className="flex items-center gap-1 text-sm font-medium text-orange-400">📍 Fizyczna lokalizacja (Opcjonalnie)</label>
              <span className="group relative inline-flex items-center">
                <button type="button" aria-label="Co to jest fizyczna lokalizacja?" className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-orange-400/60 bg-orange-500/15 text-[10px] font-bold text-orange-300 hover:bg-orange-500/30 focus:outline-none">i</button>
                <div className="pointer-events-none absolute left-0 top-6 z-50 hidden w-72 rounded-lg border border-slate-600 bg-[#0f172a] p-3 text-xs leading-relaxed text-slate-200 shadow-2xl group-focus-within:block group-hover:block">
                  <p className="mb-1 font-semibold text-orange-300">Gdzie leży papierowy oryginał?</p>
                  <p>Wpisz dokładne miejsce przechowywania wersji papierowej, aby łatwo ją później odnaleźć.</p>
                  <p className="mt-1.5 text-slate-400">Przykład: <span className="text-slate-200">„Szafka B, półka 2, segregator Faktury 2026”</span> lub <span className="text-slate-200">„Teczka osobowa – pokój 12”</span>.</p>
                </div>
              </span>
            </div>
            <input type="text" placeholder="np. Szafka biurowa A, półka 2..." value={physicalLocation} onChange={e => setPhysicalLocation(e.target.value)} className="w-full rounded-md border border-slate-600 bg-[#111827] p-2.5 text-white placeholder-slate-600 focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
        {foldersUnavailable && (
          <div role="status" className="text-sm text-amber-300">
            <p>Nie udało się pobrać kartotek z serwera. Sprawdź, czy MojaTeczka na komputerze działa.</p>
            <button type="button" onClick={onRetryFetch} className="mt-2 rounded border border-amber-500 px-3 py-1.5 text-amber-200 hover:bg-amber-500/10">Ponów połączenie</button>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {filesToUpload.length > 0 && (
              <span className="inline-flex items-center rounded-md border border-blue-800/50 bg-blue-900/40 px-3 py-2 text-xs font-bold text-blue-300">
                Łącznie: {filesToUpload.length} · {formatBytes(filesToUpload.reduce((sum, item) => sum + item.file.size, 0))}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-600 bg-[#111827] px-3 py-2 transition-colors hover:bg-slate-700">
              <input type="checkbox" checked={isMergeMode} onChange={e => setIsMergeMode(e.target.checked)} className="rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500" />
              <span className="font-medium text-slate-300">Połącz w jeden PDF</span>
            </label>
            <button type="submit" disabled={isUploading || filesToUpload.length === 0 || !folderId || foldersUnavailable || uploadDocsExceeded || uploadMergeExceeded} className="rounded-md bg-slate-200 px-6 py-2.5 font-bold text-slate-800 shadow-lg transition-colors hover:bg-white disabled:opacity-50">
              {isUploading ? 'Przetwarzanie...' : isMergeMode ? `Scal i wgraj (${filesToUpload.length}) plików` : `Wgraj osobno (${filesToUpload.length}) plików`}
            </button>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-300">Wybierz lub przeciągnij pliki do archiwizacji</label>
          <div className="flex flex-col gap-4 rounded-lg border border-slate-600 bg-[#111827]/50 p-4">
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-blue-500/40 bg-[#111827] p-5 text-center transition-colors hover:bg-[#1f2937] sm:p-6">
              <div className="opacity-90"><AppFolderIcon size="lg" /></div>
              <div className="text-sm font-medium text-slate-400">{isMobile ? 'Wybierz pliki z telefonu lub zrób zdjęcie aparatem' : 'Przeciągnij pliki tutaj lub kliknij przycisk poniżej'}</div>
              <div className="text-xs text-slate-500">Obsługiwane: PDF, obrazy (PNG/JPG), faktury KSeF (.xml) oraz e-Paragony (.json)</div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.xml,.json" onChange={onFileSelect} className="max-w-full cursor-pointer text-sm text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-blue-500" />
                {onPasteFromClipboard && (
                  <button
                    type="button"
                    onClick={onPasteFromClipboard}
                    title="Wklej zrzut ekranu lub obraz ze schowka (Ctrl+V)"
                    className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/60 hover:bg-slate-700 hover:text-white"
                  >
                    📋 Wklej ze schowka <kbd className="ml-1 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 font-mono text-[10px] text-slate-400">Ctrl+V</kbd>
                  </button>
                )}
                {isMobile && (
                  <label className="cursor-pointer rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">
                    📷 Zrób zdjęcie
                    <input type="file" accept="image/*" capture="environment" multiple onChange={onFileSelect} className="hidden" />
                  </label>
                )}
              </div>
            </div>
            {filesToUpload.length > 0 && (
              <div className="mt-2 border-t border-slate-700 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Gotowe do wgrania:</h4>
                </div>
                <ul className="custom-scrollbar max-h-56 space-y-2 overflow-y-auto pr-2">
                  {filesToUpload.map((item, idx) => (
                    <li key={idx} className="group flex items-center justify-between rounded-md border border-slate-600 bg-[#1f2937] px-4 py-3 shadow-sm transition-colors hover:border-blue-500/50">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="text-2xl">{/\.(pdf|xml|json)$/i.test(item.file.name) ? '📄' : '🖼️'}</span>
                        <div className="flex flex-col overflow-hidden">
                          <span className="truncate text-sm font-semibold text-slate-200" title={item.file.name}>{item.file.name}</span>
                          <span className="text-xs text-slate-400">{(item.file.size / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => setFilesToUpload(prev => prev.filter((_, i) => i !== idx))} className="ml-2 rounded p-2 text-slate-500 opacity-40 transition-colors hover:bg-red-900/30 hover:text-red-400 group-hover:opacity-100">🗑️ Usuń</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {isMergeMode && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-blue-500/30 bg-[#111827] p-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Tytuł scalonego PDF (WYMAGANE):</label>
              <input type="text" value={mergedTitle} onChange={e => setMergedTitle(e.target.value)} className="w-full rounded border border-slate-600 bg-[#1f2937] px-3 py-2 text-white outline-none focus:border-blue-500" placeholder="Tytuł dokumentu..." />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Termin życia dokumentu:</label>
              <div className="flex items-center gap-2">
                <input type="number" value={mergedRetentionVal} onChange={e => setMergedRetentionVal(Number(e.target.value))} className="w-20 rounded border border-slate-600 bg-[#1f2937] px-2 py-2 text-white outline-none" min="1" />
                <select value={mergedRetentionUnit} onChange={e => setMergedRetentionUnit(e.target.value as RetentionUnit)} className="rounded border border-slate-600 bg-[#1f2937] px-2 py-2 text-white outline-none">
                  <option value="years">Lata</option>
                  <option value="months">Miesiące</option>
                  <option value="days">Dni</option>
                  <option value="minutes">Minuty</option>
                </select>
                <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={mergedRetentionEnabled} onChange={e => setMergedRetentionEnabled(e.target.checked)} /> Aktywna</label>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
