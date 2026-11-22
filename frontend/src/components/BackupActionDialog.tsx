import { useState } from 'react';
import InfoTip from './InfoTip';

export type BackupActionCredentials = { username: string; password: string; code: string };
type Props = { action: 'send' | 'restore'; needsNas: boolean; needsMfa: boolean; username: string; onCancel: () => void; onSubmit: (credentials: BackupActionCredentials) => void };

export default function BackupActionDialog({ action, needsNas, needsMfa, username: initialUsername, onCancel, onSubmit }: Props) {
  const [step, setStep] = useState<'nas' | 'mfa'>(needsNas ? 'nas' : 'mfa');
  const [username, setUsername] = useState(initialUsername); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const title = action === 'send' ? 'Wyślij kopię zapasową' : 'Pobierz i przywróć kopię';
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step === 'nas' && needsMfa) { setStep('mfa'); return; }
    onSubmit({ username: username.trim(), password, code: code.trim() });
  };
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4"><section role="dialog" aria-modal="true" aria-labelledby="backup-action-title" className="w-full max-w-md rounded-xl border border-slate-600 bg-[#172338] p-6 shadow-2xl">
    <h2 id="backup-action-title" className="text-xl font-bold text-white">{title}</h2>
    <form onSubmit={submit} className="mt-4 space-y-3">
      {step === 'nas' ? <><p className="text-sm text-slate-300">Podaj swoje dane do serwera NAS. Hasło nie zostanie zapisane.</p><label className="block text-sm text-slate-200">Użytkownik NAS<input autoFocus required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-[#111827] p-3 text-white" /></label><label className="block text-sm text-slate-200">Hasło NAS<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-[#111827] p-3 text-white" /></label></> : needsMfa ? <><p className="text-sm text-slate-300">Wpisz aktualny kod Microsoft Authenticator lub jednorazowy kod odzyskiwania.</p><label className="block text-sm text-slate-200">Kod Authenticatora<input autoFocus required autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value)} className="mt-1 w-full rounded border border-slate-600 bg-[#111827] p-3 text-white" /></label></> : <p className="text-sm text-slate-300">Potwierdź wykonanie operacji.</p>}
      {step === 'nas' ? <InfoTip label="dane NAS">To login i hasło Twojego konta na QNAP-ie lub Synology. Są potrzebne do ręcznej operacji. Hasło nie jest zapisywane jako ustawienie kopii.</InfoTip> : needsMfa && <InfoTip label="kod Authenticatora">Otwórz Microsoft Authenticator na telefonie i przepisz aktualny kod MojejTeczki. Kod jest inny niż hasło NAS-a i hasło pliku klucza odzyskiwania.</InfoTip>}
      <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={onCancel} className="rounded px-4 py-2 text-slate-300">Anuluj</button>{step === 'mfa' && needsNas && <button type="button" onClick={() => setStep('nas')} className="rounded border border-slate-600 px-4 py-2 text-white">Wstecz</button>}<button type="submit" className="rounded bg-blue-600 px-4 py-2 font-semibold text-white">{step === 'nas' && needsMfa ? 'Dalej' : action === 'send' ? 'Wyślij kopię' : 'Przywróć kopię'}</button></div>
    </form>
  </section></div>;
}
