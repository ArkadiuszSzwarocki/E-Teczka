import { useEffect, useState } from 'react';
import { getElectronIpc, isAccessResult, isAccessStatus, type AccessMode } from './services/electron';

export default function DesktopAccessSettings({ onClose }: { onClose: () => void }) {
  const [currentMode, setCurrentMode] = useState<AccessMode>('pin');
  const [nextMode, setNextMode] = useState<AccessMode>('pin');
  const [currentSecret, setCurrentSecret] = useState('');
  const [nextSecret, setNextSecret] = useState('');
  const [mailConfigured, setMailConfigured] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await getElectronIpc()?.invoke('eteczka-access-status');
        if (!isAccessStatus(response)) throw new Error('Invalid lock status');
        if (response.mode) {
          setCurrentMode(response.mode);
          setNextMode(response.mode);
        }
        setMailConfigured(Boolean(response.mailConfigured));
        setRecoveryAvailable(Boolean(response.recoveryAvailable));
      } catch { setMessage('Nie można odczytać ustawień zabezpieczeń.'); }
    })();
  }, []);

  const verifyCurrent = async () => {
    const api = getElectronIpc();
    if (!api) throw new Error('Aplikacja komputerowa jest niedostępna.');
    const result = await api.invoke('eteczka-access-verify', currentSecret);
    if (!isAccessResult(result) || !result.ok) throw new Error('Podaj prawidłowy obecny PIN lub hasło.');
    return api;
  };

  const sendRecoveryCode = async () => {
    setBusy(true); setMessage('');
    try {
      const api = await verifyCurrent();
      const result = await api.invoke('eteczka-recovery-enroll-request', recoveryEmail);
      if (!isAccessResult(result) || !result.ok) throw new Error(isAccessResult(result) ? result.error : 'Nie udało się wysłać kodu.');
      setMessage('Kod wysłany. Wpisz go poniżej i potwierdź adres.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się wysłać kodu.'); }
    finally { setBusy(false); }
  };

  const confirmRecoveryEmail = async () => {
    setBusy(true); setMessage('');
    try {
      const api = await verifyCurrent();
      const result = await api.invoke('eteczka-recovery-enroll-complete', recoveryEmail, recoveryCode);
      if (!isAccessResult(result) || !result.ok) throw new Error(isAccessResult(result) ? result.error : 'Nie udało się potwierdzić adresu.');
      setRecoveryAvailable(true);
      setRecoveryCode('');
      setMessage('Adres potwierdzony. Reset dostępu e-mailem jest aktywny.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się potwierdzić adresu.'); }
    finally { setBusy(false); }
  };

  const savePassword = async () => {
    setBusy(true); setMessage('');
    try {
      const api = await verifyCurrent();
      const result = await api.invoke('eteczka-access-configure', { mode: nextMode, secret: nextSecret });
      if (!isAccessResult(result) || !result.ok) throw new Error(isAccessResult(result) ? result.error : 'Nie udało się zapisać zmian.');
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zapisać zmian.'); }
    finally { setBusy(false); }
  };

  const field = 'mt-2 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-3 text-white outline-none focus:border-blue-500';
  return <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/80 p-5">
    <section className="my-6 w-full max-w-md rounded-xl border border-slate-600 bg-[#1e293b] p-6 shadow-2xl">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-white">🔐 Zabezpieczenia</h2>
        <button onClick={onClose} className="text-xl text-slate-400 hover:text-white" aria-label="Zamknij">×</button>
      </div>
      <label className="mt-5 block text-sm font-semibold text-slate-300">Obecne {currentMode === 'pin' ? 'PIN' : 'hasło'}</label>
      <input autoFocus type="password" inputMode={currentMode === 'pin' ? 'numeric' : 'text'} value={currentSecret} onChange={event => setCurrentSecret(event.target.value)} className={field} />

      {mailConfigured && <div className="mt-6 border-t border-slate-600 pt-5">
        <h3 className="font-semibold text-white">Odzyskiwanie e-mailem</h3>
        <p className="mt-1 text-sm text-slate-400">{recoveryAvailable ? 'Adres odzyskiwania jest aktywny. Możesz go zmienić poniżej.' : 'Potwierdź adres kodem, aby włączyć reset hasła.'}</p>
        <input type="email" value={recoveryEmail} onChange={event => setRecoveryEmail(event.target.value)} placeholder="Adres e-mail do odzyskiwania" className={field} />
        <button disabled={busy || !recoveryEmail} onClick={() => void sendRecoveryCode()} className="mt-3 rounded-lg border border-blue-500 px-4 py-2 text-sm text-blue-200 disabled:opacity-50">Wyślij kod</button>
        <input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} inputMode="numeric" maxLength={8} placeholder="8-cyfrowy kod z e-maila" className={field} />
        <button disabled={busy || !recoveryCode} onClick={() => void confirmRecoveryEmail()} className="mt-3 w-full rounded-lg bg-emerald-700 py-2.5 font-semibold text-white disabled:opacity-50">Potwierdź adres odzyskiwania</button>
      </div>}

      <div className="mt-6 border-t border-slate-600 pt-5">
        <h3 className="font-semibold text-white">Zmiana PIN-u lub hasła</h3>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setNextMode('pin')} className={`flex-1 rounded-lg py-2.5 font-bold ${nextMode === 'pin' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>PIN</button>
          <button onClick={() => setNextMode('password')} className={`flex-1 rounded-lg py-2.5 font-bold ${nextMode === 'password' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Hasło</button>
        </div>
        <input type="password" inputMode={nextMode === 'pin' ? 'numeric' : 'text'} value={nextSecret} onChange={event => setNextSecret(event.target.value)} placeholder={nextMode === 'pin' ? 'Nowy PIN: min. 6 cyfr' : 'Nowe hasło: min. 8 znaków'} className={field} />
        <button disabled={busy || !nextSecret} onClick={() => void savePassword()} className="mt-4 w-full rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-50">Zmień PIN lub hasło</button>
      </div>
      {message && <p className="mt-4 text-sm text-blue-200" role="status">{message}</p>}
    </section>
  </div>;
}
