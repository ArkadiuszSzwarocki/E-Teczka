import { useEffect, useState } from 'react';
import type { TesterStorageMode } from '../hooks/useTesterConsent';
import { getSelectedDiskFolderName, isDiskStorageSupported, pickTesterDiskDirectory } from '../services/localTesterStore';
import { errorMessage } from '../utils/errors';
import type { LegalDocId } from './LegalDocsModal';

type Props = {
  userEmail: string;
  busy: boolean;
  error: string;
  onAccept: (mode: TesterStorageMode) => void;
  onDecline: () => void;
  onOpenLegalDoc: (docId: LegalDocId) => void;
};

/** First-login privacy & local disk storage notice modal for public test users. */
export default function TesterConsentModal({ userEmail, busy, error, onAccept, onDecline, onOpenLegalDoc }: Props) {
  const diskSupported = isDiskStorageSupported();
  const [mode, setMode] = useState<TesterStorageMode>(diskSupported ? 'local_disk' : 'qnap_server');
  const [folderName, setFolderName] = useState<string | null>(null);
  const [localError, setLocalError] = useState('');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void getSelectedDiskFolderName(userEmail).then(setFolderName);
  }, [userEmail]);

  const chooseFolder = async (): Promise<boolean> => {
    setLocalError('');
    try {
      const picked = await pickTesterDiskDirectory(userEmail);
      setFolderName(picked);
      return true;
    } catch (reason) {
      setLocalError(errorMessage(reason, 'Nie wybrano folderu na dysku.'));
      return false;
    }
  };

  const handleContinue = async () => {
    if (mode === 'local_disk' && !folderName) {
      const ok = await chooseFolder();
      if (!ok) return;
    }
    onAccept(mode);
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="tester-consent-title" className="my-auto w-full max-w-xl rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-400">Wersja testowa · Prywatność danych</p>
        <h2 id="tester-consent-title" className="mt-2 text-2xl font-bold text-white">Gdzie utworzyć Twoją bazę danych?</h2>
        <p className="mt-2 text-xs text-slate-400">Zalogowane konto: <strong className="text-slate-200">{userEmail}</strong></p>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
          <label className={`block rounded-xl border p-4 transition ${!diskSupported ? 'cursor-not-allowed border-slate-800 bg-slate-900/30 opacity-60' : mode === 'local_disk' ? 'cursor-pointer border-emerald-400 bg-emerald-950/25' : 'cursor-pointer border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}>
            <div className="flex items-start gap-3">
              <input type="radio" name="storageMode" disabled={!diskSupported} checked={mode === 'local_disk'} onChange={() => setMode('local_disk')} className="mt-1 accent-emerald-400" />
              <div className="flex-1">
                <p className="font-bold text-white">Utwórz bazę w folderze na moim dysku (Zalecane — pełna prywatność)</p>
                <p className="mt-1 text-xs text-slate-300">
                  Aplikacja utworzy plik bazy (`eteczka-db.json`) i podfolder `uploads/` bezpośrednio we wskazanym folderze na Twoim komputerze. Dane nie są wysyłane na QNAP i nie znikną po wyczyszczeniu przeglądarki ani po aktualizacji serwera.
                </p>
                {diskSupported ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => { setMode('local_disk'); void chooseFolder(); }} className="rounded border border-emerald-400/60 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
                      {folderName ? `Wybrany folder: ${folderName} (Zmień)` : '📁 Wybierz folder na dysku…'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-amber-300">Zapis na dysk wymaga Chrome lub Edge na komputerze.</p>
                )}
              </div>
            </div>
          </label>

          <label className={`block cursor-pointer rounded-xl border p-4 transition ${mode === 'qnap_server' ? 'border-blue-400 bg-blue-950/25' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}>
            <div className="flex items-start gap-3">
              <input type="radio" name="storageMode" checked={mode === 'qnap_server'} onChange={() => setMode('qnap_server')} className="mt-1 accent-blue-400" />
              <div>
                <p className="font-bold text-white">Na serwerze testowym QNAP (wiele urządzeń / Pakiet Rodzinny)</p>
                <p className="mt-1 text-xs text-slate-300">
                  Dokumenty zapisywane są w testowej bazie SQLite na serwerze QNAP — dzięki temu działają na telefonie, wielu urządzeniach oraz w Pakiecie Rodzinnym.
                </p>
              </div>
            </div>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs text-blue-300">
          <button type="button" onClick={() => onOpenLegalDoc('privacy')} className="underline hover:text-white">Polityka prywatności</button>
          <button type="button" onClick={() => onOpenLegalDoc('terms')} className="underline hover:text-white">Regulamin</button>
          <button type="button" onClick={() => onOpenLegalDoc('storage')} className="underline hover:text-white">Gdzie przechowywane są dane</button>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-200">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-400" />
          <span>
            Rozumiem zasady przechowywania danych w wersji testowej i wyrażam zgodę na zapisanie mojego wyboru oraz odnotowanie tej zgody w bazie konta testowego.
          </span>
        </label>

        {(localError || error) && <p role="status" className="mt-3 text-sm text-red-300">{localError || error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <button type="button" disabled={busy} onClick={onDecline} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            Nie wyrażam zgody (wyloguj)
          </button>
          <button type="button" disabled={busy || !checked} onClick={() => void handleContinue()} className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-40">
            {mode === 'local_disk' && !folderName ? 'Wybierz folder na dysku i akceptuj' : 'Akceptuję i przechodzę dalej'}
          </button>
        </div>
      </section>
    </div>
  );
}
