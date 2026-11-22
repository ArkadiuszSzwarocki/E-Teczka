import SecretInput from './components/SecretInput';
import React, { useEffect, useState } from 'react';
import { getElectronIpc, isAccessResult, isAccessStatus, type AccessMode } from './services/electron';

export default function AccessLock({ children, optionalSetup = false }: { children: React.ReactNode; optionalSetup?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [helloEnabled, setHelloEnabled] = useState(false);
  const [mode, setMode] = useState<AccessMode>('pin');
  const [newMode, setNewMode] = useState<AccessMode>('pin');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [recoveryView, setRecoveryView] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [confirmNewSecret, setConfirmNewSecret] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const api = getElectronIpc();
      if (!api) {
        setUnlocked(true);
        setLoading(false);
        return;
      }
      try {
        const token = localStorage.getItem('eteczka_auth_token');
        if (token && optionalSetup) { const selected = await api.invoke('eteczka-access-use-account', token); if (!isAccessResult(selected) || !selected.ok) throw new Error('Nie udało się wybrać blokady konta.'); }
        const response = await api.invoke('eteczka-access-status');
        if (!isAccessStatus(response)) throw new Error('Nieprawidłowa odpowiedź blokady.');
        const status = response;
        setConfigured(status.configured);
        setHelloEnabled(status.loginMethod === 'hello');
        if (status.loginMethod === 'hello' && (status.helloVerified || optionalSetup)) setUnlocked(true);
        if (optionalSetup && status.loginMethod !== 'hello' && (!status.configured || status.loginMethod === 'password')) setUnlocked(true);
        if (status.mode) { setMode(status.mode); setNewMode(status.mode); }
        setRecoveryAvailable(Boolean(status.recoveryAvailable));
        setMailConfigured(Boolean(status.mailConfigured));
      } catch {
        setError('Nie można odczytać ustawień blokady.');
      } finally {
        setLoading(false);
      }
    });
  }, [optionalSetup]);

  const submit = async () => {
    if (!configured && secret !== confirmSecret) { setError('Wpisane wartości muszą być identyczne.'); return; }
    const api = getElectronIpc();
    if (!api) return;
    setError('');
    try {
      const response = configured
        ? await api.invoke('eteczka-access-verify', secret)
        : await api.invoke('eteczka-access-configure', { mode, secret, ...(recoveryEmail ? { recoveryEmail, recoveryCode } : {}) });
      if (!isAccessResult(response)) { setError('Nieprawidłowa odpowiedź blokady.'); return; }
      if (!response.ok) { setError(response.error ?? 'Nieprawidłowy PIN lub hasło.'); return; }
      setSecret('');
      setUnlocked(true);
    } catch {
      setError('Nie można połączyć się z mechanizmem blokady aplikacji.');
    }
  };

  const sendCode = async (purpose: 'enroll' | 'reset') => {
    const api = getElectronIpc(); if (!api) return;
    setRecoveryBusy(true); setError(''); setRecoveryMessage('');
    try {
      const result = purpose === 'reset'
        ? await api.invoke('eteczka-recovery-reset-request')
        : await api.invoke('eteczka-recovery-enroll-request', recoveryEmail);
      if (!isAccessResult(result) || !result.ok) setError(isAccessResult(result) ? result.error || 'Nie udało się wysłać kodu.' : 'Nieprawidłowa odpowiedź.');
      else setRecoveryMessage('Kod wysłany na adres odzyskiwania. Jest ważny 10 minut.');
    } catch { setError('Nie udało się wysłać kodu.'); }
    finally { setRecoveryBusy(false); }
  };

  const resetAccess = async () => {
    if (newSecret !== confirmNewSecret) { setError('Wpisane wartości muszą być identyczne.'); return; }
    const api = getElectronIpc(); if (!api) return;
    setRecoveryBusy(true); setError('');
    try {
      const result = await api.invoke('eteczka-recovery-reset-complete', { code: recoveryCode, mode: newMode, secret: newSecret });
      if (!isAccessResult(result) || !result.ok) { setError(isAccessResult(result) ? result.error || 'Nie udało się zmienić hasła.' : 'Nieprawidłowa odpowiedź.'); return; }
      setRecoveryCode(''); setNewSecret(''); setUnlocked(true);
    } catch { setError('Nie udało się zmienić hasła.'); }
    finally { setRecoveryBusy(false); }
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a]" />;
  if (unlocked) return <>{children}</>;
  if (helloEnabled) return <main className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center p-6"><section className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#1e293b] p-8 shadow-2xl"><h1 className="text-2xl font-bold">Odblokuj MojąTeczkę</h1><p className="mt-3 text-sm leading-6 text-slate-400">Potwierdź tożsamość za pomocą Windows Hello.</p><button onClick={() => void (async () => { setError(''); try { const result = await getElectronIpc()?.invoke('eteczka-hello-verify'); if (isAccessResult(result) && result.ok) setUnlocked(true); else setError(isAccessResult(result) ? result.error || 'Weryfikacja nie została ukończona.' : 'Windows Hello jest niedostępne.'); } catch { setError('Nie udało się uruchomić Windows Hello.'); } })()} className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-semibold hover:bg-blue-500">Odblokuj przez Windows Hello</button>{error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}</section></main>;

  const title = configured ? 'MojaTeczka jest zablokowana' : 'Zabezpiecz MojąTeczkę';
  const subtitle = configured
    ? `Wpisz ${mode === 'pin' ? 'PIN' : 'hasło'}, aby otworzyć dokumenty.`
    : 'Wybierz metodę otwierania aplikacji. Będzie wymagana po każdym ponownym uruchomieniu.';

  return <main className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center p-6">
    <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#1e293b] p-8 shadow-2xl">
      <div className="w-14 h-14 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-3xl mb-5">🔐</div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-slate-400 text-sm leading-6 mt-2">{subtitle}</p>
      {!configured && <div className="flex gap-2 mt-6">
        <button onClick={() => { setMode('pin'); setSecret(''); setConfirmSecret(''); setError(''); }} className={`flex-1 rounded-lg py-3 font-bold ${mode === 'pin' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'}`}>PIN</button>
        <button onClick={() => { setMode('password'); setSecret(''); setConfirmSecret(''); setError(''); }} className={`flex-1 rounded-lg py-3 font-bold ${mode === 'password' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'}`}>Hasło</button>
      </div>}
      {recoveryView ? <>
        <p className="mt-5 text-sm text-slate-300">Nie potrzebujesz starego hasła ani PIN-u. Wyślemy kod na potwierdzony adres odzyskiwania.</p>
        <button disabled={recoveryBusy} onClick={() => void sendCode('reset')} className="mt-3 w-full rounded-lg border border-blue-500 px-4 py-3 font-semibold text-blue-200 disabled:opacity-50">Wyślij kod resetowania e-mailem</button>
        <label className="mt-4 block text-sm text-slate-300">Kod z wiadomości</label>
        <input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} inputMode="numeric" maxLength={8} placeholder="8-cyfrowy kod" className="mt-2 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-4 py-3 text-white" />
        <p className="mt-4 text-sm text-slate-300">Nowa metoda otwierania</p>
        <div className="mt-2 flex gap-2">
          <button onClick={() => { setNewMode('pin'); setNewSecret(''); setConfirmNewSecret(''); }} className={`flex-1 rounded-lg py-2 font-semibold ${newMode === 'pin' ? 'bg-blue-600' : 'bg-slate-700'}`}>PIN</button>
          <button onClick={() => { setNewMode('password'); setNewSecret(''); setConfirmNewSecret(''); }} className={`flex-1 rounded-lg py-2 font-semibold ${newMode === 'password' ? 'bg-blue-600' : 'bg-slate-700'}`}>Hasło</button>
        </div>
        <SecretInput value={newSecret} onChange={event => setNewSecret(event.target.value)}  inputMode={newMode === 'pin' ? 'numeric' : 'text'} placeholder={newMode === 'pin' ? 'Nowy PIN (min. 6 cyfr)' : 'Nowe hasło (min. 8 znaków)'} className="mt-3 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-4 py-3 text-white" />
        <SecretInput key={newMode+'-repeat'} value={confirmNewSecret} onChange={event => setConfirmNewSecret(event.target.value)} autoComplete="new-password" inputMode={newMode === 'pin' ? 'numeric' : 'text'} placeholder={newMode === 'pin' ? 'Powtórz nowy PIN' : 'Powtórz nowe hasło'} className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-white" />
        {recoveryMessage && <p className="mt-3 text-sm text-emerald-300">{recoveryMessage}</p>}
      </> : <>
        <label className="block text-sm font-semibold text-slate-300 mt-6">{mode === 'pin' ? 'PIN (co najmniej 6 cyfr)' : 'Hasło (co najmniej 8 znaków)'}</label>
        <SecretInput autoFocus value={secret} onChange={event => setSecret(event.target.value)} onKeyDown={event => event.key === 'Enter' && submit()}  inputMode={mode === 'pin' ? 'numeric' : 'text'} className="mt-2 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-4 py-3 text-center text-lg outline-none focus:border-blue-500" placeholder={mode === 'pin' ? 'Wpisz PIN' : 'Wpisz hasło'} />
        {!configured && <SecretInput key={mode+'-repeat'} value={confirmSecret} onChange={event => setConfirmSecret(event.target.value)} autoComplete="new-password" inputMode={mode === 'pin' ? 'numeric' : 'text'} placeholder={mode === 'pin' ? 'Powtórz PIN' : 'Powtórz hasło'} className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-white" />}
        {!configured && mailConfigured && <><input value={recoveryEmail} onChange={event => setRecoveryEmail(event.target.value)} type="email" placeholder="E-mail do odzyskiwania (opcjonalnie)" className="mt-4 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-4 py-3 text-white" /><button disabled={recoveryBusy || !recoveryEmail} onClick={() => void sendCode('enroll')} className="mt-2 text-sm text-blue-300 disabled:opacity-50">Wyślij kod potwierdzający adres</button>{recoveryEmail && <input value={recoveryCode} onChange={event => setRecoveryCode(event.target.value)} inputMode="numeric" maxLength={8} placeholder="Kod z e-maila" className="mt-2 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-4 py-3 text-white" />}</>}
      </>}
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      {configured && helloEnabled && !recoveryView && (
        <button
          onClick={() => void (async () => {
            setError('');
            const res = await getElectronIpc()?.invoke('eteczka-hello-verify');
            if (isAccessResult(res) && res.ok) setUnlocked(true);
            else setError(isAccessResult(res) && res.error ? res.error : 'Weryfikacja Windows Hello nie powiodła się.');
          })()}
          className="mt-4 w-full rounded-lg border border-emerald-500/60 bg-emerald-950/40 py-3 font-bold text-emerald-200 hover:bg-emerald-900/50"
        >
          Odblokuj przez Windows Hello
        </button>
      )}
      <button disabled={recoveryBusy || (recoveryView ? (!recoveryCode || !newSecret || newSecret !== confirmNewSecret) : (!configured && (!secret || secret !== confirmSecret)))} onClick={() => void (recoveryView ? resetAccess() : submit())} className="mt-5 w-full rounded-lg bg-blue-600 py-3.5 font-bold hover:bg-blue-500 disabled:opacity-50">{recoveryView ? 'Potwierdź kod i ustaw nowy dostęp' : configured ? 'Otwórz MojąTeczkę' : 'Włącz blokadę aplikacji'}</button>
      {configured && recoveryAvailable && <button onClick={() => { setRecoveryView(!recoveryView); setError(''); }} className="mt-4 w-full rounded-lg border border-blue-500 px-4 py-3 text-sm font-semibold text-blue-200">{recoveryView ? 'Wróć do wpisywania hasła / PIN-u' : 'Nie pamiętam hasła ani PIN-u — reset e-mailem'}</button>}
      {configured && !recoveryAvailable && <p className="mt-4 text-center text-xs text-slate-400">Reset e-mailem nie był skonfigurowany dla tej blokady.</p>}
      {!configured && <p className="text-xs text-slate-500 leading-5 mt-5">Biometria na komputerze będzie korzystać z Windows Hello. Dodam ją jako natywną funkcję aplikacji po przygotowaniu podpisanej wersji instalacyjnej.</p>}
    </section>
  </main>;
}
