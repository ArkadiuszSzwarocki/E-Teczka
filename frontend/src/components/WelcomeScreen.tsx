import SecretInput from './SecretInput';
import { useEffect, useState, type FormEvent } from 'react';
import CentralSignIn from './CentralSignIn';
import { resolveApiBase } from '../services/apiBase';

type Props = { onContinue: () => void; onAuthenticated: (user: { email: string; name?: string | null }) => void };
export default function WelcomeScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'register' | 'login'>(() => new URLSearchParams(window.location.search).get('account') === 'register' ? 'register' : 'login');
  const [origin, setOrigin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [hasCentralSession, setHasCentralSession] = useState(false);
  const [connection, setConnection] = useState('Sprawdzanie usługi kont…');
  const apiUrl = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
  const [deviceId] = useState(() => {
    const existing = localStorage.getItem('eteczka_device_id');
    if (existing) return existing;
    const value = crypto.randomUUID(); localStorage.setItem('eteczka_device_id', value); return value;
  });
  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/api/central-account/status`).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (active) { setOrigin(data.origin || ''); setConnection(data.configured ? '' : 'Usługa kont nie jest skonfigurowana.'); }
    }).catch(() => { if (active) setConnection('Nie można połączyć się z aplikacją. Sprawdź, czy serwer jest uruchomiony.'); });
    return () => { active = false; };
  }, [apiUrl]);
  async function register(event: FormEvent) {
    event.preventDefault(); setMessage('');
    if (password !== confirmation) { setMessage('Hasła muszą być takie same.'); return; }
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/central-account/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Nie udało się utworzyć konta.');
      setSent(true); setPassword(''); setConfirmation(''); setMessage(payload.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd połączenia. Spróbuj ponownie.'); }
    finally { setBusy(false); }
  }
  const input = 'mt-1 w-full rounded-xl border border-slate-600 bg-slate-950/60 px-4 py-2.5 text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20';
  return <main className="welcome-screen fixed inset-0 z-[100] overflow-y-auto bg-[#0b1120] text-slate-200">
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6 py-4 md:px-10">
      <header className="flex items-center justify-between gap-4"><span className="text-xl font-bold tracking-tight text-white">E<span className="text-blue-400">‑</span>Teczka<span className="ml-3 text-xs font-normal uppercase tracking-widest text-slate-500">Twoje archiwum</span></span></header>
      <div className="grid flex-1 items-center gap-8 py-4 lg:grid-cols-2 lg:gap-12">
        <section><p className="mb-6 text-xs font-semibold uppercase tracking-[0.25em] text-blue-400">Mniej papieru. Więcej porządku.</p><h1 className="text-4xl font-semibold leading-tight tracking-tight text-white md:text-6xl">Wszystkie dokumenty.<br /><span className="text-blue-400">Jedno miejsce.</span></h1><p className="mt-6 max-w-md text-lg leading-relaxed text-slate-400">Uporządkuj swoje kartoteki, skanuj dokumenty i miej ważne sprawy pod kontrolą.</p><div className="mt-6 space-y-4">{[['01', 'Zacznij od swojego konta', 'Potwierdź adres e-mail i zaloguj się do E‑Teczki.'], ['02', 'Uporządkuj dokumenty', 'Twórz kartoteki, dodawaj pliki i oznaczaj je tagami.'], ['03', 'Pracuj na swoim komputerze', 'Połącz konto z lokalnym archiwum lub utwórz nowe.'], ['04', 'Korzystaj także na urządzeniach mobilnych', 'Pracuj na telefonie i tablecie. Dodawaj skany z aparatu, skanera lub drukarki wielofunkcyjnej.']].map(([number, title, description]) => <div key={number} className="flex gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-xs text-blue-300">{number}</span><div><h2 className="font-medium text-slate-200">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div></div>)}</div></section>
        <section className="rounded-3xl border border-slate-700/70 bg-slate-900 p-5 shadow-2xl md:p-6" aria-labelledby="welcome-title">{!hasCentralSession && <div className="mb-4 flex gap-1 rounded-xl bg-slate-950 p-1">{(['login', 'register'] as const).map(value => <button key={value} onClick={() => { setMode(value); setMessage(''); }} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium ${mode === value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>{value === 'register' ? 'Utwórz konto' : 'Zaloguj się'}</button>)}</div>}
          <h2 id="welcome-title" className="text-2xl font-semibold text-white">{mode === 'register' ? sent ? 'Sprawdź swoją pocztę' : 'Zacznij z E‑Teczką' : 'Dobrze Cię widzieć'}</h2>
          {connection && <p role="status" className="mt-4 text-sm text-amber-200">{connection}</p>}
          {mode === 'register' ? sent ? <div className="mt-5 space-y-5"><p role="status" className="leading-relaxed text-slate-300">{message || 'Jeśli konto można utworzyć, wyślemy wiadomość potwierdzającą.'}</p><p className="text-sm leading-relaxed text-slate-400">Otwórz link z wiadomości, potwierdź adres i ustaw hasło. Następnie wróć tutaj, aby się zalogować. Sprawdź również folder spam.</p><button onClick={() => { setMode('login'); setMessage(''); }} className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-500">Przejdź do logowania</button><button onClick={() => { setSent(false); setMessage(''); }} className="w-full text-sm text-slate-400">Użyj innego adresu e-mail</button></div> : <form onSubmit={event => void register(event)} className="mt-4 space-y-3"><label className="block text-sm text-slate-300">Adres e-mail<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="twoj@email.pl" className={input} /></label><label className="block text-sm text-slate-300">Hasło<SecretInput required autoComplete="new-password" minLength={8} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} placeholder="Minimum 8 znaków" className={input} /></label><label className="block text-sm text-slate-300">Powtórz hasło<SecretInput required autoComplete="new-password" minLength={8} maxLength={200} value={confirmation} onChange={event => setConfirmation(event.target.value)} className={input} /></label>{message && <p role="alert" className="rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{message}</p>}<button disabled={busy || !origin} className="w-full rounded-xl bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{busy ? 'Tworzenie konta…' : 'Utwórz bezpłatne konto →'}</button></form> : origin && <CentralSignIn apiUrl={apiUrl} origin={origin} deviceId={deviceId} onBack={() => setMode('register')} onAuthenticated={onAuthenticated} onSessionStateChange={setHasCentralSession} />}
          {mode === 'register' && !sent && origin && <CentralSignIn googleRegistration apiUrl={apiUrl} origin={origin} deviceId={deviceId} onBack={() => setMode('register')} onAuthenticated={onAuthenticated} />}
        </section>
      </div><footer className="border-t border-slate-800 pt-3 text-xs text-slate-500">E‑Teczka · Twoje cyfrowe archiwum dokumentów</footer>
    </div>
  </main>;
}
