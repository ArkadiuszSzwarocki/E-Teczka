import { useEffect, useState } from 'react';
import { getElectronIpc } from '../services/electron';
import {
  clearLocalTesterWorkspace,
  hasActiveDiskPermission,
  isDiskStorageSupported,
  pickTesterDiskDirectory,
  requestSavedDiskPermission,
} from '../services/localTesterStore';
import { isAndroidBrowser } from '../services/platform';

const TRUSTED_WEB_COPY_KEY = 'eteczka_trusted_local_copy_v1';

type TrustedDbStatus = {
  trustedDataDir: string | null;
  dbFile: string | null;
  trustedAt: string | null;
  dirExists?: boolean;
  dbExists?: boolean;
  exists: boolean;
  isExternalBackend: boolean;
};

type PickedDb = {
  dir: string;
  dbFile: string;
  existingDb: boolean;
  isJsonDb?: boolean;
  hasUploads: boolean;
  hasSecurity: boolean;
};

/** Settings card allowing desktop and web/Android users to select, trust, and auto-attach a local E-Teczka data copy. */
export function TrustedDatabaseCard({ accountEmail = '' }: { accountEmail?: string }) {
  const ipc = getElectronIpc();
  const isAndroid = isAndroidBrowser();
  const diskSupported = isDiskStorageSupported();
  const [status, setStatus] = useState<TrustedDbStatus | null>(null);
  const [picked, setPicked] = useState<PickedDb | null>(null);
  const [webFolderName, setWebFolderName] = useState<string | null>(null);
  const [webDiskGranted, setWebDiskGranted] = useState(false);
  const [webCopyTrusted, setWebCopyTrusted] = useState<boolean>(() => localStorage.getItem(TRUSTED_WEB_COPY_KEY) === 'true');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (ipc) {
      try {
        const res = await ipc.invoke('eteczka-trusted-db-get') as TrustedDbStatus | null;
        if (res) setStatus(res);
      } catch { /* ignore */ }
      return;
    }
    if (accountEmail && diskSupported) {
      try {
        const perm = await hasActiveDiskPermission(accountEmail);
        setWebFolderName(perm.folderName);
        setWebDiskGranted(perm.hasHandle && perm.granted);
      } catch { /* ignore */ }
    }
  };

  useEffect(() => { void refresh(); }, [accountEmail]);

  if (!ipc) {
    const handleWebPickFolder = async () => {
      if (!accountEmail) {
        setMessage('Zaloguj się na konto, aby zapisać lokalny folder bazy.');
        return;
      }
      setBusy(true);
      setMessage('');
      try {
        const pickedFolderName = await pickTesterDiskDirectory(accountEmail);
        setWebFolderName(pickedFolderName);
        setWebDiskGranted(true);
        localStorage.setItem(TRUSTED_WEB_COPY_KEY, 'true');
        setWebCopyTrusted(true);
        setMessage(`Zapamiętano lokalny folder „${pickedFolderName}” jako zaufaną kopię bazy.`);
      } catch (err) {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setMessage(err instanceof Error ? err.message : 'Nie udało się wybrać folderu w przeglądarce.');
        }
      } finally {
        setBusy(false);
      }
    };

    const handleWebReconnect = async () => {
      if (!accountEmail) return;
      setBusy(true);
      setMessage('');
      try {
        const granted = await requestSavedDiskPermission(accountEmail);
        setWebDiskGranted(granted);
        if (granted) {
          const perm = await hasActiveDiskPermission(accountEmail);
          setWebFolderName(perm.folderName);
          localStorage.setItem(TRUSTED_WEB_COPY_KEY, 'true');
          setWebCopyTrusted(true);
          setMessage('Przywrócono dostęp do zaufanej lokalnej kopii bazy.');
        }
      } finally {
        setBusy(false);
      }
    };

    const handleToggleWebTrust = (trusted: boolean) => {
      if (trusted) {
        localStorage.setItem(TRUSTED_WEB_COPY_KEY, 'true');
        setWebCopyTrusted(true);
        setMessage('Lokalna kopia na tym urządzeniu została zapamiętana jako zaufana.');
      } else {
        localStorage.removeItem(TRUSTED_WEB_COPY_KEY);
        setWebCopyTrusted(false);
        if (accountEmail) void clearLocalTesterWorkspace(accountEmail);
        setWebFolderName(null);
        setWebDiskGranted(false);
        setMessage('Cofnięto zaufanie dla lokalnej kopii na tym urządzeniu.');
      }
    };

    return (
      <div className="mx-auto mt-6 max-w-6xl space-y-3 rounded-2xl border border-slate-700 bg-slate-800/40 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">🗄️ Zaufana lokalna kopia bazy</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {diskSupported
                ? 'Wskaż lokalny folder w pamięci urządzenia i zapamiętaj go jako zaufaną kopię bazy danych.'
                : isAndroid
                  ? 'Przeglądarka na Androidzie przechowuje lokalną kopię bazy w pamięci urządzenia (IndexedDB). Możesz ją zapamiętać jako zaufaną dla tego telefonu.'
                  : 'Zapamiętaj lokalną kopię bazy danych w pamięci tej przeglądarki jako zaufaną.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {diskSupported && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleWebPickFolder()}
                className="rounded-lg border border-cyan-500/60 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-45"
              >
                📂 Wybierz katalog bazy…
              </button>
            )}
            {diskSupported && webFolderName && !webDiskGranted && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleWebReconnect()}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-45"
              >
                🔓 Odblokuj zaufany folder
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => handleToggleWebTrust(!webCopyTrusted)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                webCopyTrusted
                  ? 'border border-emerald-500/50 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {webCopyTrusted ? '✅ Zapamiętano jako zaufaną (Kliknij, aby cofnąć)' : '✅ Zapamiętaj lokalną kopię jako zaufaną'}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-300">
          Status na tym urządzeniu:{' '}
          {webFolderName ? (
            <span className={webDiskGranted ? 'font-mono text-emerald-300' : 'font-mono text-amber-300'}>
              {webFolderName} {webDiskGranted ? '(zaufana ✓)' : '(wymaga ponownego odblokowania)'}
            </span>
          ) : webCopyTrusted ? (
            <span className="text-emerald-300">Lokalna kopia w pamięci urządzenia zapamiętana jako zaufana ✓</span>
          ) : (
            <span className="text-slate-400">Niezapamiętana (domyślny tryb sesji)</span>
          )}
        </p>
        {message && (
          <p role="status" className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-100">
            {message}
          </p>
        )}
      </div>
    );
  }

  const handlePick = async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await ipc.invoke('eteczka-trusted-db-pick') as PickedDb | null;
      if (res) setPicked(res);
    } catch {
      setMessage('Zrestartuj okno desktopowe, aby aktywować wybór zaufanej bazy.');
    } finally {
      setBusy(false);
    }
  };

  const handleTrust = async () => {
    if (!picked) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await ipc.invoke('eteczka-trusted-db-trust', { dir: picked.dir, dbFile: picked.dbFile }) as { ok?: boolean; error?: string };
      if (!res?.ok) throw new Error(res?.error || 'Nie udało się zapisać zaufanej bazy.');
      setPicked(null);
      await refresh();
      setMessage('Zaufana baza zapisana. Będzie podpinana automatycznie przy każdym uruchomieniu aplikacji (zrestartuj aplikację, aby przełączyć od razu).');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Błąd zapisu zaufanej bazy.');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setMessage('');
    try {
      await ipc.invoke('eteczka-trusted-db-clear');
      setPicked(null);
      await refresh();
      setMessage('Przywrócono domyślną bazę aplikacji (zacznie działać po restarcie).');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-6 space-y-3 rounded-2xl border border-slate-700 bg-slate-800/40 px-6 py-4 max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">🗄️ Zaufana baza danych (.db + uploads + security)</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Wskaż katalog z istniejącą bazą i potwierdź, że jej ufasz — aplikacja będzie automatycznie podpinać ją przy każdym uruchomieniu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handlePick()}
            className="rounded-lg border border-cyan-500/60 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-45"
          >
            📂 Wybierz katalog bazy…
          </button>
          {status?.trustedDataDir && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleClear()}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-45"
            >
              ↩️ Przywróć domyślną
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-300">
        Aktywna konfiguracja:{' '}
        {status?.trustedDataDir ? (
          <span className={`font-mono ${status.exists ? 'text-emerald-300' : 'text-amber-300'}`}>
            {status.trustedDataDir}{' '}
            {status.exists
              ? '(zaufana ✓)'
              : status.dirExists && !status.dbExists
                ? '(katalog istnieje ✓, ale brak pliku .db — skopiuj tam plik .db lub wybierz folder z bazą)'
                : '(brak katalogu na dysku ⚠️)'}
          </span>
        ) : (
          <span className="text-slate-400">Domyślna lokalna baza aplikacji</span>
        )}
      </p>

      {picked && (
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-950/25 p-3 text-xs text-amber-100">
          <p className="font-semibold">Wybrany katalog: <span className="font-mono">{picked.dir}</span></p>
          <p>
            Plik bazy: <span className="font-mono">{picked.dbFile}</span>{' '}
            ({picked.isJsonDb
              ? 'znaleziono eteczka-db.json z trybu lokalnego/web ⚠️ — baza desktopowa wymaga pliku .db (SQLite)'
              : picked.existingDb
                ? 'znaleziono istniejącą bazę .db ✓'
                : 'nowa baza .db'})
          </p>
          <p>Katalogi: uploads ({picked.hasUploads ? '✓' : 'utworzy się'}), security ({picked.hasSecurity ? '✓' : 'utworzy się'})</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleTrust()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-45"
            >
              ✅ Ufam tej bazie i podpinaj za każdym razem
            </button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-100">
          {message}
        </p>
      )}
    </div>
  );
}
