import { useEffect, useState, type ReactNode } from 'react';
import WelcomeScreen from './WelcomeScreen';
import { resolveApiBase } from '../services/apiBase';
export default function AccountGate({ children }: { children: ReactNode }) {
 const [authenticated, setAuthenticated] = useState(false), [checking, setChecking] = useState(true);
 const [error, setError] = useState('');
 useEffect(() => {
  let active = true;
  let expiryTimer: number | undefined;
  function expire(token: string) {
   if (!active || localStorage.getItem('eteczka_auth_token') !== token) return;
   localStorage.removeItem('eteczka_auth_token'); setAuthenticated(false); setChecking(false);
   setError('Sesja wygasła po 20 minutach. Zaloguj się ponownie.');
   window.dispatchEvent(new Event('eteczka-auth-changed'));
  }
  async function check() {
   const token = localStorage.getItem('eteczka_auth_token');
   if (!token) { if (active) { setAuthenticated(false); setChecking(false); } return; }
   try {
    const base = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
    const response = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (response.status === 401) { localStorage.removeItem('eteczka_auth_token'); if (active) setAuthenticated(false); }
    else if (!response.ok) throw new Error();
    else { const user = await response.json(); if (!user.email) throw new Error(); if (active && localStorage.getItem('eteczka_auth_token') === token) {
      const expiry = Date.parse(user.expiresAt); if (!Number.isFinite(expiry)) throw new Error();
      window.clearTimeout(expiryTimer);
      if (expiry <= Date.now()) { expire(token); return; }
      expiryTimer = window.setTimeout(() => expire(token), expiry - Date.now());
      setAuthenticated(true); setError('');
    } }
   } catch { if (active) { setAuthenticated(false); setError('Nie udało się sprawdzić sesji. Sprawdź połączenie z serwerem i zaloguj się ponownie.'); } }
   finally { if (active) setChecking(false); }
  }
  void check(); const timer = window.setInterval(() => void check(), 60000); window.addEventListener('eteczka-auth-changed', check); window.addEventListener('focus', check);
  return () => { active = false; window.clearInterval(timer); window.clearTimeout(expiryTimer); window.removeEventListener('focus', check); window.removeEventListener('eteczka-auth-changed', check); };
 }, []);
 if (checking) return <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">Sprawdzanie konta…</main>;
 if (!authenticated) return <>{error && <p role="alert" className="fixed bottom-4 left-4 z-[150] max-w-md rounded-lg bg-red-950 p-4 text-sm text-red-200">{error}</p>}<WelcomeScreen onContinue={() => undefined} onAuthenticated={() => { setError(''); window.dispatchEvent(new Event('eteczka-auth-changed')); }} /></>;
 return <>{children}</>;
}
