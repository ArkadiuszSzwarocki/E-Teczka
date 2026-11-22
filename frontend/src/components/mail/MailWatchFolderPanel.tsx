import { useRef, useState } from 'react';
import { getElectronIpc } from '../../services/electron';
import { isIosBrowser, isMobileBrowser } from '../../services/platform';

const MOBILE_WATCH_FOLDER_KEY = 'mojateczka_mobile_watch_folder_v1';

type Props = {
  watchPath: string;
  watchAllowed: boolean;
  watchBusy: boolean;
  pendingCount?: number;
  onPathChange: (value: string) => void;
  onSaveOrScan: (scanAfter: boolean) => Promise<void>;
  onUploadMobileFiles?: (files: File[], folderName: string) => Promise<void>;
  onDiscardPending?: () => Promise<void>;
};

/** Configuration and manual scan controls for the Premium watch folder (desktop + Android/mobile). */
export function MailWatchFolderPanel({ watchPath, watchAllowed, watchBusy, pendingCount = 0, onPathChange, onSaveOrScan, onUploadMobileFiles, onDiscardPending }: Props) {
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState('');
  const [mobileFolderName, setMobileFolderName] = useState<string>(() => localStorage.getItem(MOBILE_WATCH_FOLDER_KEY) || '');
  const [mobileFiles, setMobileFiles] = useState<File[]>([]);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const ipc = getElectronIpc();
  const isMobile = isMobileBrowser();
  const isIos = isIosBrowser();

  if (isMobile && !ipc) {
    const handleMobileFilesSelected = (list: FileList | null, fromDirectory: boolean) => {
      if (!list || !list.length) return;
      const all = Array.from(list);
      const supported = all.filter(f => /\.(pdf|png|jpe?g|xml|json)$/i.test(f.name) && f.size > 0);
      const firstRel = (all[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      const folderLabel = fromDirectory && firstRel.includes('/')
        ? firstRel.split('/')[0]
        : (fromDirectory ? 'Folder na telefonie' : `Wybrane pliki (${supported.length})`);
      setMobileFolderName(folderLabel);
      localStorage.setItem(MOBILE_WATCH_FOLDER_KEY, folderLabel);
      setMobileFiles(supported);
      setPickError(supported.length ? '' : 'W wybranym folderze nie ma plików PDF, PNG ani JPG.');
    };

    const handleMobileScan = async () => {
      if (!onUploadMobileFiles) return;
      if (!mobileFiles.length) {
        folderInputRef.current?.click();
        return;
      }
      await onUploadMobileFiles(mobileFiles, mobileFolderName || 'Folder na telefonie');
      setMobileFiles([]);
    };

    return (
      <section className="space-y-3 rounded-xl border border-slate-700 bg-[#1e293b] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">📂 Folder obserwowany ({isIos ? 'iPhone / iPad' : 'Android / Telefon'})</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {isIos
                ? 'Wybierz pliki PDF lub zdjęcia z aplikacji Pliki / iCloud Drive — trafią od razu do poczekalni poniżej.'
                : 'Wybierz folder lub pliki z pamięci telefonu — nowe PDF/obrazy trafią od razu do poczekalni poniżej.'}
            </p>
          </div>
          {!watchAllowed && <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">Wymaga Premium</span>}
        </div>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported in Android Chrome & Chromium
          webkitdirectory=""
          directory=""
          onChange={e => { handleMobileFilesSelected(e.target.files, true); e.target.value = ''; }}
          className="hidden"
        />
        <input
          ref={filesInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.xml,.json"
          onChange={e => { handleMobileFilesSelected(e.target.files, false); e.target.value = ''; }}
          className="hidden"
        />
        <div className="flex flex-wrap items-center gap-2">
          {!isIos && (
            <button
              type="button"
              disabled={!watchAllowed || watchBusy}
              onClick={() => folderInputRef.current?.click()}
              className="rounded-lg border border-cyan-500/60 bg-cyan-950/40 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-40"
            >
              📂 Wybierz folder z telefonu…
            </button>
          )}
          <button
            type="button"
            disabled={!watchAllowed || watchBusy}
            onClick={() => filesInputRef.current?.click()}
            className={`rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
              isIos
                ? 'border border-cyan-500/60 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50'
                : 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {isIos ? '📂 Wybierz z Plików / iCloud…' : '📄 Wybierz pliki'}
          </button>
          <button
            type="button"
            disabled={!watchAllowed || watchBusy || !mobileFiles.length}
            onClick={() => void handleMobileScan()}
            className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {watchBusy ? 'Skanowanie…' : `🔍 Skanuj folder${mobileFiles.length ? ` (${mobileFiles.length})` : ''}`}
          </button>
          {pendingCount > 0 && onDiscardPending && (
            <button
              type="button"
              disabled={watchBusy}
              onClick={() => void onDiscardPending()}
              className="rounded-lg border border-rose-500/50 bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 disabled:opacity-40"
            >
              🗑️ Odrzuć z folderu ({pendingCount})
            </button>
          )}
        </div>
        {(mobileFolderName || mobileFiles.length > 0) && (
          <p className="rounded-lg border border-cyan-500/40 bg-cyan-950/25 px-3 py-2 text-xs text-cyan-100">
            Wybrano: <strong>{mobileFolderName || 'Folder na telefonie'}</strong>
            {mobileFiles.length > 0 ? ` · gotowe do skanu: ${mobileFiles.length} plików PDF/JPG/PNG` : ' · kliknij „Wybierz folder” lub „Wybierz pliki”, aby pobrać nowe dokumenty'}
          </p>
        )}
        {pickError && <p role="alert" className="text-xs text-rose-300">⚠️ {pickError}</p>}
      </section>
    );
  }

  const handleBrowseFolder = async () => {
    if (!watchAllowed || picking) return;
    if (!ipc) {
      setPickError('Wybór folderu z dysku przez okno systemowe jest dostępny tylko w aplikacji desktopowej na komputerze (Windows). Na Androidzie i w przeglądarce dodaj pliki przez „Dodaj dokument” albo wpisz ścieżkę katalogu serwera.');
      return;
    }
    setPicking(true);
    setPickError('');
    try {
      const selected = await ipc.invoke('mojateczka-pick-directory', watchPath);
      if (typeof selected === 'string' && selected.trim()) {
        onPathChange(selected.trim());
      }
    } catch {
      setPickError('Zrestartuj okno desktopowe (MojaTeczka-dev-desktop.ps1), aby wczytać nową funkcję wyboru folderu w Electronie.');
    } finally {
      setPicking(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-700 bg-[#1e293b] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">📂 Folder obserwowany (Premium)</h3>
          <p className="mt-0.5 text-xs text-slate-400">Wybierz lokalny folder na komputerze (np. folder ze skanera). Nowe PDF/obrazy trafią do poczekalni poniżej.</p>
        </div>
        {!watchAllowed && <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">Wymaga Premium</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ipc && (
          <button
            type="button"
            disabled={!watchAllowed || watchBusy || picking}
            onClick={() => void handleBrowseFolder()}
            className="rounded-lg border border-cyan-500/60 bg-cyan-950/40 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-40"
          >
            {picking ? 'Wybieranie…' : '📂 Wybierz folder…'}
          </button>
        )}
        <input
          value={watchPath}
          readOnly={Boolean(ipc)}
          onClick={() => { if (ipc && watchAllowed) void handleBrowseFolder(); }}
          onChange={e => onPathChange(e.target.value)}
          disabled={!watchAllowed}
          placeholder={ipc ? 'Kliknij „Wybierz folder…”, aby wskazać katalog w Windows' : 'np. C:\\Users\\TwojeKonto\\Downloads\\Do-ETeczki'}
          className={`min-w-[260px] flex-1 rounded-lg border px-3 py-2 text-xs disabled:opacity-50 ${
            watchPath.trim()
              ? 'border-cyan-400 bg-cyan-950/35 text-cyan-100 ring-1 ring-cyan-400/40'
              : 'border-slate-600 bg-[#0f172a] text-white'
          } ${ipc && watchAllowed ? 'cursor-pointer' : ''}`}
        />
        {watchPath.trim() && (
          <button
            type="button"
            disabled={!watchAllowed || watchBusy}
            onClick={() => onPathChange('')}
            title="Wyczyść wybrany folder"
            className="rounded-lg border border-slate-600 px-2.5 py-2 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            ✕
          </button>
        )}
        <button
          type="button"
          disabled={!watchAllowed || watchBusy}
          onClick={() => void onSaveOrScan(false)}
          className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          Zapisz folder
        </button>
        <button
          type="button"
          disabled={!watchAllowed || watchBusy || !watchPath.trim()}
          onClick={() => void onSaveOrScan(true)}
          className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
        >
          {watchBusy ? 'Skanowanie…' : '🔍 Skanuj folder'}
        </button>
        {pendingCount > 0 && onDiscardPending && (
          <button
            type="button"
            disabled={watchBusy}
            onClick={() => void onDiscardPending()}
            className="rounded-lg border border-rose-500/50 bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 disabled:opacity-40"
          >
            🗑️ Odrzuć z folderu ({pendingCount})
          </button>
        )}
      </div>
      {pickError && <p role="alert" className="mt-2 text-xs text-rose-300">⚠️ {pickError}</p>}
    </section>
  );
}
