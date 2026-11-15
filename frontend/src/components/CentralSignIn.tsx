import { useEffect, useRef, useState } from 'react';
import { openExternalAccountUrl } from '../services/electron';

type User = { email: string; name?: string | null };
type Start = { handle: string; displayCode: string; expiresAt: number; url: string };
type Props = { apiUrl: string; origin: string; deviceId: string; onBack: () => void; onAuthenticated: (user: User) => void };

export default function CentralSignIn({ apiUrl, origin, deviceId, onBack, onAuthenticated }: Props) {
  const [start, setStart] = useState<Start | null>(null); const [user, setUser] = useState<User | null>(null);
  const [needsLink, setNeedsLink] = useState(false); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [desktopSecret, setDesktopSecret] = useState('');
  const [newLocalPassword, setNewLocalPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const polling = useRef(false);
  async function post(path: string, body: object, localToken?: string) {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(localToken ? { authorization: `Bearer ${localToken}` } : {}) }, body: JSON.stringify(body), redirect: 'error' });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    return { response, payload };
  }
  function finishSession(payload: { token?: string; user?: User }) {
    if (typeof payload.token !== 'string' || !payload.user?.email) throw new Error('Serwer zwrócił nieprawidłową sesję.');
    localStorage.setItem('eteczka_auth_token', payload.token); setPassword(''); onAuthenticated(payload.user);
  }
  async function begin() {
    setBusy(true); setMessage(''); setNeedsLink(false); setUser(null);
    try {
      const { response, payload } = await post('/api/central-account/handoff/start', {});
      if (!response.ok || !payload.handle || !payload.url) throw new Error(payload.error || 'Nie udało się rozpocząć logowania.');
      await openExternalAccountUrl(payload.url, origin); setStart(payload as Start);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się rozpocząć logowania.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!start || user) return;
    let active = true;
    const check = async () => {
      if (polling.current) return;
      if (Date.now() >= start.expiresAt) { if (active) { setMessage('Kod wygasł. Rozpocznij logowanie ponownie.'); setStart(null); } return; }
      polling.current = true;
      try { const { response, payload } = await post('/api/central-account/handoff/poll', { handle: start.handle }); if (!response.ok) throw new Error(payload.error || 'Błąd połączenia.'); if (active && payload.status === 'approved' && payload.user?.email) setUser(payload.user); }
      catch { if (active) setMessage('Nie udało się sprawdzić logowania. Próba zostanie ponowiona.'); }
      finally { polling.current = false; }
    };
    void check(); const timer = window.setInterval(() => void check(), 3500);
    return () => { active = false; window.clearInterval(timer); };
  }, [start, user]);
  async function finish() {
    if (!start) return; setBusy(true); setMessage('');
    try { const { response, payload } = await post('/api/central-account/handoff/finish', { handle: start.handle, deviceId, deviceName: 'E‑Teczka Desktop' }); if (response.status === 409 && payload.code === 'LOCAL_LINK_REQUIRED') { setNeedsLink(true); return; } if (!response.ok) throw new Error(payload.error || 'Nie udało się zalogować.'); finishSession(payload); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zalogować.'); } finally { setBusy(false); }
  }
  async function linkExisting() {
    if (!start) return; setBusy(true); setMessage('');
    try {
      const local = await post('/api/auth/login', { email, password, deviceId, deviceName: 'E‑Teczka Desktop' });
      if (!local.response.ok || typeof local.payload.token !== 'string') throw new Error(local.payload.error || 'Nie udało się zalogować lokalnie.');
      const linked = await post('/api/central-account/handoff/link', { handle: start.handle }, local.payload.token);
      if (!linked.response.ok) throw new Error(linked.payload.error || 'Nie udało się połączyć kont.');
      finishSession(local.payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się połączyć kont.'); } finally { setBusy(false); }
  }
  async function createLocal() {
    if (!start) return; setBusy(true); setMessage('');
    try { const { response, payload } = await post('/api/central-account/handoff/create-local', { handle: start.handle, localPassword: newLocalPassword, deviceId, deviceName: 'E‑Teczka Desktop' }); if (!response.ok) throw new Error(payload.error || 'Nie udało się utworzyć konta.'); setNewLocalPassword(''); finishSession(payload); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się utworzyć konta.'); } finally { setBusy(false); }
  }
  async function linkDesktop() {
    if (!start) return; setBusy(true); setMessage('');
    try { const { response, payload } = await post('/api/central-account/handoff/link-desktop', { handle: start.handle, secret: desktopSecret, deviceId, deviceName: 'E‑Teczka Desktop' }); if (!response.ok) throw new Error(payload.error || 'Nie udało się połączyć danych.'); setDesktopSecret(''); finishSession(payload); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się połączyć danych.'); } finally { setBusy(false); }
  }
  const button = 'mt-3 w-full rounded-lg bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50';
  return <div><p className="mt-4 text-sm text-slate-300">Zaloguj się w przeglądarce przez Google albo e-mail i porównaj kod z kodem w aplikacji.</p>
    {!start && <button disabled={busy} onClick={() => void begin()} className={button}>Otwórz logowanie</button>}
    {start && !user && <div className="mt-4 rounded-lg border border-slate-600 p-4"><p className="text-sm text-slate-300">Potwierdź w przeglądarce kod:</p><p className="mt-1 text-3xl font-bold tracking-widest text-white">{start.displayCode}</p><button className="mt-3 text-sm text-blue-300" onClick={() => void openExternalAccountUrl(start.url, origin).catch(() => setMessage('Nie udało się otworzyć przeglądarki.'))}>Otwórz przeglądarkę ponownie</button></div>}
    {user && !needsLink && <><p className="mt-4 text-sm text-slate-200">Potwierdzono konto: <strong>{user.email}</strong></p><button disabled={busy} onClick={() => void finish()} className={button}>Kontynuuj jako {user.email}</button></>}
    {needsLink && <div className="mt-4 space-y-3"><p className="text-sm text-slate-300">Jeśli używasz danych zapisanych na tym komputerze, potwierdź PIN lub hasło otwierające E‑Teczkę.</p><input aria-label="PIN lub hasło aplikacji" value={desktopSecret} onChange={e => setDesktopSecret(e.target.value)} placeholder="PIN lub hasło aplikacji" type="password" autoComplete="off" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><button disabled={busy} onClick={() => void linkDesktop()} className={button}>Połącz z danymi tego komputera</button><p className="text-sm text-slate-300">Jeśli masz osobne konto lokalne, zaloguj się na nie:</p><input aria-label="E-mail konta lokalnego" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail konta lokalnego" autoComplete="email" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><input aria-label="Hasło konta lokalnego" value={password} onChange={e => setPassword(e.target.value)} placeholder="Hasło konta lokalnego" type="password" autoComplete="current-password" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><button disabled={busy} onClick={() => void linkExisting()} className={button}>Połącz z kontem lokalnym</button><p className="text-sm text-slate-300">Nowe konto potrzebuje osobnego hasła lokalnego do pracy bez internetu.</p><input aria-label="Nowe hasło lokalne" value={newLocalPassword} onChange={e => setNewLocalPassword(e.target.value)} placeholder="Nowe hasło lokalne (minimum 8 znaków)" type="password" autoComplete="new-password" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><button disabled={busy} onClick={() => void createLocal()} className="w-full rounded-lg border border-slate-600 px-4 py-3 text-sm text-slate-200 disabled:opacity-50">Utwórz nowe, puste konto na tym komputerze</button></div>}
    {message && <p role="status" className="mt-3 text-sm text-red-300">{message}</p>}<button onClick={onBack} className="mt-4 w-full text-sm text-blue-300">Wróć do logowania lokalnego</button>
  </div>;
}
