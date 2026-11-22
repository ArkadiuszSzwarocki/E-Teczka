import { useState } from 'react';
import InfoTip from './InfoTip';

type Props = { apiUrl: string; mode: 'settings' | 'restore'; authorize: (action: string) => Promise<Record<string, string>>; disabled: boolean; onRecovery: (file: File | null, password: string) => void };
export default function BackupRecoveryKey({ apiUrl, mode, authorize, disabled, onRecovery }: Props) {
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [file, setFile] = useState<File | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const download = async () => {
    if (password.length < 12 || password !== confirmation) { setMessage('Wpisz identyczne hasło o długości co najmniej 12 znaków w obu polach.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`${apiUrl}/api/backup/recovery-key`, { method: 'POST', headers: { ...await authorize('recoveryKey'), 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: password }) });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Nie udało się przygotować klucza.'); }
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'mojateczka-klucz-odzyskiwania.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Zapisz plik i hasło oddzielnie, poza tym komputerem. Będą potrzebne do odzyskania zaszyfrowanej kopii.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się przygotować klucza.'); } finally { setBusy(false); }
  };
  return <details className="mt-4 rounded-lg border border-slate-600 p-3 text-sm text-slate-200"><summary className="cursor-pointer font-semibold">Klucz odzyskiwania zaszyfrowanej kopii</summary>
    <InfoTip label="klucz odzyskiwania">Kopia na NAS-ie jest zaszyfrowana kluczem tego komputera. Pobierz plik odzyskiwania i przechowuj go poza komputerem, a jego hasło osobno. Po awarii komputera oba będą potrzebne do odczytania kopii, jeśli nie masz starego klucza. To hasło jest inne niż hasło NAS-a i kod Authenticatora.</InfoTip>
    <p className="mt-2 text-xs text-slate-400">{mode === 'settings' ? 'Utwórz klucz przed awarią komputera. Hasło musi mieć co najmniej 12 znaków. Utrata pliku lub hasła uniemożliwi jego użycie.' : 'Jeśli kopia pochodzi z innego komputera, wybierz wcześniej zapisany plik klucza i podaj jego hasło.'}</p>
    <input type="password" value={password} onChange={event => { setPassword(event.target.value); onRecovery(file, event.target.value); }} autoComplete="new-password" placeholder="Hasło klucza odzyskiwania" aria-label="Hasło klucza odzyskiwania" className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-2 text-white" />
    {mode === 'settings' && <><input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" placeholder="Powtórz hasło przy tworzeniu klucza" aria-label="Powtórz hasło klucza" className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-2 text-white" />
    <button type="button" disabled={disabled || busy} onClick={() => void download()} className="mt-2 w-full rounded border border-blue-400 p-2 disabled:opacity-50">Utwórz i pobierz klucz odzyskiwania</button></>}
    {mode === 'restore' && <><label className="mt-3 block text-xs">Przy odzyskiwaniu na nowym komputerze wybierz plik klucza i wpisz jego hasło powyżej:<input type="file" accept="application/json,.json" disabled={disabled} onChange={event => { const next = event.target.files?.[0] || null; setFile(next); onRecovery(next, password); }} className="mt-2 block w-full" /></label>
    <InfoTip label="przywracanie kluczem">Na nowym komputerze wybierz zapisany plik klucza, wpisz jego hasło powyżej, a następnie wybierz kopię do przywrócenia. Ten plik klucza nie jest samą kopią dokumentów.</InfoTip></>}
    {message && <p role="status" className="mt-2 text-xs text-slate-300">{message}</p>}
  </details>;
}
