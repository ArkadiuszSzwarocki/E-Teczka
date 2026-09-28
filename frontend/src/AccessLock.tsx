import React, { useEffect, useState } from 'react';
import { getElectronIpc, isAccessResult, isAccessStatus, type AccessMode } from './services/electron';

export default function AccessLock({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<AccessMode>('pin');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const api = getElectronIpc();
      if (!api) {
        setUnlocked(true);
        setLoading(false);
        return;
      }
      try {
        const response = await api.invoke('eteczka-access-status');
        if (!isAccessStatus(response)) throw new Error('Nieprawidłowa odpowiedź blokady.');
        const status = response;
        setConfigured(status.configured);
        if (status.mode) setMode(status.mode);
      } catch {
        setError('Nie można odczytać ustawień blokady.');
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const submit = async () => {
    const api = getElectronIpc();
    if (!api) return;
    setError('');
    try {
      const response = configured
        ? await api.invoke('eteczka-access-verify', secret)
        : await api.invoke('eteczka-access-configure', { mode, secret });
      if (!isAccessResult(response)) { setError('Nieprawidłowa odpowiedź blokady.'); return; }
      if (!response.ok) { setError(response.error ?? 'Nieprawidłowy PIN lub hasło.'); return; }
      setSecret('');
      setUnlocked(true);
    } catch {
      setError('Nie można połączyć się z mechanizmem blokady aplikacji.');
    }
  };

  if (loading) return <div className="min-h-screen bg-[#0f172a]" />;
  if (unlocked) return <>{children}</>;

  const title = configured ? 'E‑Teczka jest zablokowana' : 'Zabezpiecz E‑Teczkę';
  const subtitle = configured
    ? `Wpisz ${mode === 'pin' ? 'PIN' : 'hasło'}, aby otworzyć dokumenty.`
    : 'Wybierz metodę otwierania aplikacji. Będzie wymagana po każdym ponownym uruchomieniu.';

  return <main className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center p-6">
    <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#1e293b] p-8 shadow-2xl">
      <div className="w-14 h-14 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-3xl mb-5">🔐</div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-slate-400 text-sm leading-6 mt-2">{subtitle}</p>
      {!configured && <div className="flex gap-2 mt-6">
        <button onClick={() => { setMode('pin'); setSecret(''); setError(''); }} className={`flex-1 rounded-lg py-3 font-bold ${mode === 'pin' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'}`}>PIN</button>
        <button onClick={() => { setMode('password'); setSecret(''); setError(''); }} className={`flex-1 rounded-lg py-3 font-bold ${mode === 'password' ? 'bg-blue-600' : 'bg-slate-700 text-slate-300'}`}>Hasło</button>
      </div>}
      <label className="block text-sm font-semibold text-slate-300 mt-6">{mode === 'pin' ? 'PIN (co najmniej 6 cyfr)' : 'Hasło (co najmniej 8 znaków)'}</label>
      <input autoFocus value={secret} onChange={event => setSecret(event.target.value)} onKeyDown={event => event.key === 'Enter' && submit()} type="password" inputMode={mode === 'pin' ? 'numeric' : 'text'} className="mt-2 w-full rounded-lg border border-slate-600 bg-[#0f172a] px-4 py-3 text-center text-lg outline-none focus:border-blue-500" placeholder={mode === 'pin' ? 'Wpisz PIN' : 'Wpisz hasło'} />
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      <button onClick={submit} className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 py-3.5 font-bold mt-5">{configured ? 'Otwórz E‑Teczkę' : 'Włącz blokadę aplikacji'}</button>
      {!configured && <p className="text-xs text-slate-500 leading-5 mt-5">Biometria na komputerze będzie korzystać z Windows Hello. Dodam ją jako natywną funkcję aplikacji po przygotowaniu podpisanej wersji instalacyjnej.</p>}
    </section>
  </main>;
}
