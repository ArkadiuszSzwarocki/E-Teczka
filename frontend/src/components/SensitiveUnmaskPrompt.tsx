import { useEffect, useState } from 'react';
import { getElectronIpc, isAccessResult, isAccessStatus } from '../services/electron';

type UnmaskMethod = 'local' | 'password' | 'totp';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  onUnlocked: () => void;
  onCancel?: () => void;
};

/** Verifies local PIN/password, account password, or Authenticator TOTP before unmasking sensitive document data. */
export default function SensitiveUnmaskPrompt({ apiUrl, fetcher, onUnlocked, onCancel }: Props) {
  const [hasLocalAccess, setHasLocalAccess] = useState(false);
  const [method, setMethod] = useState<UnmaskMethod>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const ipc = getElectronIpc();
    if (!ipc) return;
    void ipc.invoke('eteczka-access-status').then(status => {
      if (isAccessStatus(status) && status.configured) {
        setHasLocalAccess(true);
        setMethod('local');
      }
    }).catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('Wpisz kod lub hasło.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (method === 'local') {
        const ipc = getElectronIpc();
        if (!ipc) throw new Error('Lokalny PIN jest dostępny tylko w aplikacji desktopowej.');
        const res = await ipc.invoke('eteczka-access-verify', trimmed);
        if (!isAccessResult(res) || !res.ok) {
          throw new Error((isAccessResult(res) && res.error) || 'Nieprawidłowy kod PIN lub hasło lokalne.');
        }
        onUnlocked();
        return;
      }

      const response = await fetcher(`${apiUrl}/api/account-security/verify-unmask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, code: trimmed }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; verified?: boolean };
      if (!response.ok || !data.verified) {
        throw new Error(data.error || 'Nie udało się zweryfikować kodu.');
      }
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd weryfikacji.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={e => void submit(e)} className="w-full max-w-md rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
      <div className="mb-3 flex items-center gap-2 text-amber-300">
        <span className="text-xl" aria-hidden="true">🛡️</span>
        <h4 className="text-base font-bold text-white">Odkoduj wrażliwe dane</h4>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-400">
        Dokument zawiera zamaskowane dane wrażliwe. Podaj kod PIN/hasło lub jednorazowy kod z Authenticatora, aby tymczasowo odsłonić podgląd.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {hasLocalAccess && (
          <button type="button" onClick={() => { setMethod('local'); setCode(''); setError(''); }} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${method === 'local' ? 'bg-blue-600 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
            PIN / hasło lokalne
          </button>
        )}
        <button type="button" onClick={() => { setMethod('totp'); setCode(''); setError(''); }} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${method === 'totp' ? 'bg-blue-600 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
          Authenticator (TOTP)
        </button>
        <button type="button" onClick={() => { setMethod('password'); setCode(''); setError(''); }} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${method === 'password' ? 'bg-blue-600 text-white' : 'border border-slate-600 text-slate-300 hover:bg-slate-800'}`}>
          Hasło konta
        </button>
      </div>

      <input
        type={method === 'totp' ? 'text' : 'password'}
        inputMode={method === 'totp' ? 'numeric' : undefined}
        autoFocus
        value={code}
        onChange={e => setCode(e.target.value)}
        placeholder={method === 'totp' ? 'Kod 6-cyfrowy z Authenticatora...' : method === 'local' ? 'Wpisz lokalny PIN lub hasło...' : 'Wpisz hasło konta E‑Teczki...'}
        className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500"
      />
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-300">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800">
            Anuluj
          </button>
        )}
        <button type="submit" disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
          {busy ? 'Sprawdzanie…' : '🔓 Odkoduj'}
        </button>
      </div>
    </form>
  );
}
