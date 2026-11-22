import { useState } from 'react';
import { errorMessage } from '../utils/errors';
import { clearLocalTesterWorkspace } from '../services/localTesterStore';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  userEmail: string;
  onErased: (notice?: string) => void;
  onClose: () => void;
};

/** Confirmation modal for permanently erasing all local, server, and browser data for the current account. */
export default function DeleteAccountModal({ apiUrl, fetcher, userEmail, onErased, onClose }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const [deleteCentral, setDeleteCentral] = useState(true);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleErase = async () => {
    if (confirmation.trim().toUpperCase() !== 'USUŃ') {
      setError('Wpisz dokładnie słowo USUŃ, aby potwierdzić.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetcher(`${apiUrl}/api/account-security/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmation.trim(), deleteCentral, password }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; centralNote?: string; centralDeleted?: boolean };
      if (!response.ok) throw new Error(payload.error || 'Nie udało się usunąć konta.');

      await clearLocalTesterWorkspace(userEmail).catch(() => undefined);
      const emailKey = userEmail.trim().toLowerCase();
      localStorage.removeItem('mojateczka_auth_token');
      localStorage.removeItem(`mojateczka_mobile_onboarding_v1:${emailKey}`);
      localStorage.removeItem('mojateczka_default_scanner');

      onErased(payload.centralNote || (payload.centralDeleted ? 'Konto i wszystkie dane zostały całkowicie usunięte.' : 'Wszystkie dane i konto w MojejTeczce zostały trwale usunięte.'));
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się usunąć konta.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="my-auto w-full max-w-lg rounded-2xl border border-red-500/60 bg-[#0f172a] p-6 text-slate-200 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 pb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-red-400">Operacja nieodwracalna</p>
            <h2 id="delete-account-title" className="mt-1 text-xl font-bold text-white">Usuń konto i wszystkie dane</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <p>
            Usunięcie konta <strong className="text-white">{userEmail}</strong> trwale wymaże bez śladu:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
            <li>wszystkie kartoteki, dokumenty, pliki, tagi, archiwum, kosz i Sejf,</li>
            <li>bazę lokalną przeglądarki (`IndexedDB`), tokeny sesji i wpisy `TesterConsent`,</li>
            <li>powiązania rodzinne i ustawienia bezpieczeństwa.</li>
          </ul>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs">
            <input type="checkbox" checked={deleteCentral} onChange={e => setDeleteCentral(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-500" />
            <span>Usuń także globalny login z serwera kont `konto.arecki.pl` (wymaga podania hasła konta; przy samym Google możesz to zrobić później na `konto.arecki.pl/account`).</span>
          </label>

          {deleteCentral && (
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Hasło do konta (opcjonalnie, jeśli logujesz się hasłem)"
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-white focus:border-red-400 focus:outline-none"
            />
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300">
              Aby potwierdzić, wpisz słowo <span className="font-mono text-red-300">USUŃ</span>:
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={e => setConfirmation(e.target.value)}
              placeholder="USUŃ"
              className="mt-1.5 w-full rounded-lg border border-red-500/50 bg-[#111827] px-3 py-2 font-mono text-sm uppercase text-white focus:border-red-400 focus:outline-none"
            />
          </div>
        </div>

        {error && <p role="status" className="mt-3 text-sm text-red-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            Anuluj
          </button>
          <button type="button" disabled={busy || confirmation.trim().toUpperCase() !== 'USUŃ'} onClick={() => void handleErase()} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40">
            {busy ? 'Usuwanie…' : 'Usuń trwale bez śladu'}
          </button>
        </div>
      </section>
    </div>
  );
}
