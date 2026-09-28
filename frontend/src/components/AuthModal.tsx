import { useState } from 'react';

type Props = { onClose: () => void; onAuthenticated: (user: { name?: string | null; email: string }) => void };

export default function AuthModal({ onClose, onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`http://localhost:3000/api/auth/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.token !== 'string') throw new Error(payload.error || 'Nie udało się zalogować.');
      localStorage.setItem('eteczka_auth_token', payload.token);
      onAuthenticated(payload.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się wykonać operacji.'); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-slate-600 bg-[#0f172a] p-7 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-xl font-bold text-white">{mode === 'login' ? 'Zaloguj się' : 'Utwórz konto'}</h3><button onClick={onClose} className="text-2xl text-slate-400">×</button></div><p className="mt-2 text-sm text-slate-400">Konto oddziela Twoje kartoteki i subskrypcję od innych użytkowników.</p><label className="mt-6 block text-sm text-slate-300">E‑mail<input value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" className="mt-1 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /></label><label className="mt-4 block text-sm text-slate-300">Hasło<input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="mt-1 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /></label>{error && <p className="mt-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}<button disabled={busy} onClick={() => void submit()} className="mt-6 w-full rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-500 disabled:opacity-50">{busy ? 'Trwa…' : mode === 'login' ? 'Zaloguj' : 'Utwórz konto'}</button><button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="mt-3 w-full text-sm text-blue-300 hover:text-blue-200">{mode === 'login' ? 'Nie mam jeszcze konta' : 'Mam już konto'}</button></div></div>;
}
