import { useEffect, useRef, useState } from 'react';
import { openExternalAccountUrl } from '../services/electron';

type User = { email: string; name?: string | null };
type Start = { handle: string; displayCode: string; expiresAt: number; url: string };
type Props = { apiUrl: string; origin: string; deviceId: string; onBack: () => void; onAuthenticated: (user: User) => void };

export default function CentralSignIn({ apiUrl, origin, deviceId, onBack, onAuthenticated }: Props) {
  const [start, setStart] = useState<Start | null>(null); const [user, setUser] = useState<User | null>(null);
  const [mfaRequired,setMfaRequired] = useState(false);
  const [mfaCode,setMfaCode] = useState('');
  const [needsLink, setNeedsLink] = useState(false); const [email, setEmail] = useState(() => localStorage.getItem('eteczka_remembered_email') || '');
  const [rememberEmail, setRememberEmail] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false); const [password, setPassword] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  useEffect(() => { let active = true; void fetch(`${apiUrl}/api/central-account/status`).then(r => r.ok ? r.json() : null).then(data => { if (active) setGoogleEnabled(data?.googleEnabled === true); }).catch(() => undefined); return () => { active = false; }; }, [apiUrl]);
  const [desktopSecret, setDesktopSecret] = useState('');
  const [newLocalPassword, setNewLocalPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const polling = useRef(false);
  async function post(path: string, body: object, localToken?: string) {
    const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(localToken ? { authorization: `Bearer ${localToken}` } : {}) }, body: JSON.stringify({ ...body, mfaCode }), redirect: 'error' });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    return { response, payload };
  }
  function finishSession(payload: { token?: string; user?: User }) {
    if (typeof payload.token !== 'string' || !payload.user?.email) throw new Error('Serwer zwrócił nieprawidłową sesję.');
    if (rememberEmail) localStorage.setItem('eteczka_remembered_email', payload.user.email); else localStorage.removeItem('eteczka_remembered_email');
    localStorage.setItem('eteczka_auth_token', payload.token); setPassword(''); onAuthenticated(payload.user);
  }
  async function requestReset(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage('');
    try {
      const { response, payload } = await post('/api/central-account/request-password-reset', { email });
      if (!response.ok) throw new Error(payload.error || 'Nie udało się wysłać prośby.');
      setRecoverySent(true); setMessage(payload.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd połączenia.'); }
    finally { setBusy(false); }
  }
  async function credentialsLogin(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const { response, payload } = await post('/api/central-account/credentials', { email, password });
      if (!response.ok || !payload.handle || !payload.user?.email) throw new Error(payload.error || 'Nie udało się zalogować.');
      if (rememberEmail) localStorage.setItem('eteczka_remembered_email', payload.user.email); else localStorage.removeItem('eteczka_remembered_email');
      setPassword(''); setStart(payload as Start); setUser(payload.user);
      const finished = await post('/api/central-account/handoff/finish', { handle: payload.handle, createNew: true, deviceId, deviceName: 'E‑Teczka Desktop' });
      if (finished.response.status === 409 && ['LOCAL_LINK_REQUIRED', 'LOCAL_ACCOUNT_EXISTS'].includes(finished.payload.code)) { setNeedsLink(true); return; }
      if (finished.payload.code === 'MFA_REQUIRED') { setMfaRequired(true); setMessage(finished.payload.error); return; }
      if (!finished.response.ok) throw new Error(finished.payload.error || 'Nie udało się otworzyć konta.');
      finishSession(finished.payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd logowania.'); }
    finally { setBusy(false); }
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
    try { const { response, payload } = await post('/api/central-account/handoff/finish', { handle: start.handle, createNew: true, deviceId, deviceName: 'E‑Teczka Desktop' }); if (response.status === 409 && ['LOCAL_LINK_REQUIRED', 'LOCAL_ACCOUNT_EXISTS'].includes(payload.code)) { setNeedsLink(true); return; } if (payload.code === 'MFA_REQUIRED') setMfaRequired(true); if (!response.ok) throw new Error(payload.error || 'Nie udało się zalogować.'); finishSession(payload); }
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
  if (recovery) return <section className="mt-5"><h3 className="text-lg font-semibold text-white">Nie pamiętasz hasła?</h3><p className="mt-3 text-sm leading-6 text-slate-400">Podaj e-mail użyty przy rejestracji. Jeśli konto umożliwia zmianę hasła, otrzymasz jednorazowy link ważny przez godzinę.</p><form onSubmit={event => void requestReset(event)}><label className="mt-4 block text-sm text-slate-300">E-mail konta<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setRecoverySent(false); setMessage(''); }} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-white" /></label><button disabled={busy || recoverySent} className={button}>{busy ? 'Wysyłanie…' : recoverySent ? 'Prośba została przyjęta' : 'Wyślij link do zmiany hasła'}</button></form>{message && <p role="status" className="mt-4 rounded-lg border border-slate-600 p-3 text-sm leading-6 text-slate-200">{message}</p>}<p className="mt-4 text-xs leading-5 text-slate-400">Otwórz pełny link z wiadomości i ustaw nowe hasło na stronie konto.arecki.pl. Nie musisz podawać PIN-u ani hasła Windows. Jeśli nie pamiętasz adresu, sprawdź swoje skrzynki pod kątem wiadomości od E‑Teczki.</p><button type="button" onClick={() => { setRecovery(false); setRecoverySent(false); setMessage(''); }} className="mt-5 w-full text-sm text-blue-300">← Wróć do logowania</button></section>;
  return <div><p className="mt-4 text-sm text-slate-300">Wpisz e-mail i hasło. Logowanie odbywa się tutaj, w aplikacji.</p>
    {!start && <><form onSubmit={event => void credentialsLogin(event)} className="mt-4 space-y-3"><label className="block text-sm text-slate-300">E-mail<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-white" /></label><label className="block text-sm text-slate-300">Hasło<input required type="password" autoComplete="current-password" maxLength={200} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 text-white" /></label><label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={rememberEmail} onChange={event => { setRememberEmail(event.target.checked); if (!event.target.checked) localStorage.removeItem('eteczka_remembered_email'); }} />Zapamiętaj e-mail na tym komputerze</label><button disabled={busy} className={button}>{busy ? 'Logowanie…' : 'Zaloguj się'}</button></form><button type="button" disabled={busy} onClick={() => { setRecovery(true); setRecoverySent(false); setMessage(''); setPassword(''); }} className="mt-4 w-full text-sm text-blue-300 hover:text-blue-200">Nie pamiętam hasła</button>{googleEnabled && <button type="button" disabled={busy} onClick={() => void begin()} className="mt-4 w-full text-sm text-blue-300">Zaloguj przez Google ↗</button>}</>}
    {start && !user && <div className="mt-4 rounded-lg border border-slate-600 p-4"><p className="text-sm text-slate-300">Potwierdź w przeglądarce kod:</p><p className="mt-1 text-3xl font-bold tracking-widest text-white">{start.displayCode}</p><button className="mt-3 text-sm text-blue-300" onClick={() => void openExternalAccountUrl(start.url, origin).catch(() => setMessage('Nie udało się otworzyć przeglądarki.'))}>Otwórz przeglądarkę ponownie</button></div>}
    {user && !needsLink && <>{mfaRequired && <label className="mt-4 block text-sm text-slate-300">Kod Microsoft Authenticator lub kod odzyskiwania<input value={mfaCode} onChange={event=>setMfaCode(event.target.value)} autoComplete="one-time-code" maxLength={24} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3 font-mono text-white" /></label>}<p className="mt-4 text-sm text-slate-200">Potwierdzono konto: <strong>{user.email}</strong></p><button disabled={busy} onClick={() => void finish()} className={button}>Kontynuuj jako {user.email}</button></>}
    {needsLink && <div className="mt-4 space-y-3"><p className="text-sm text-slate-300">Jeśli używasz danych zapisanych na tym komputerze, potwierdź PIN lub hasło otwierające E‑Teczkę.</p><input aria-label="PIN lub hasło aplikacji" value={desktopSecret} onChange={e => setDesktopSecret(e.target.value)} placeholder="PIN lub hasło aplikacji" type="password" autoComplete="off" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><button disabled={busy} onClick={() => void linkDesktop()} className={button}>Połącz z danymi tego komputera</button><p className="text-sm text-slate-300">Jeśli masz osobne konto lokalne, zaloguj się na nie:</p><input aria-label="E-mail konta lokalnego" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail konta lokalnego" autoComplete="email" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><input aria-label="Hasło konta lokalnego" value={password} onChange={e => setPassword(e.target.value)} placeholder="Hasło konta lokalnego" type="password" autoComplete="current-password" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><button disabled={busy} onClick={() => void linkExisting()} className={button}>Połącz z kontem lokalnym</button><p className="text-sm text-slate-300">Nowe konto potrzebuje osobnego hasła lokalnego do pracy bez internetu.</p><input aria-label="Nowe hasło lokalne" value={newLocalPassword} onChange={e => setNewLocalPassword(e.target.value)} placeholder="Nowe hasło lokalne (minimum 8 znaków)" type="password" autoComplete="new-password" className="w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /><button disabled={busy} onClick={() => void createLocal()} className="w-full rounded-lg border border-slate-600 px-4 py-3 text-sm text-slate-200 disabled:opacity-50">Utwórz nowe, puste konto na tym komputerze</button></div>}
    {message && <p role="status" className="mt-3 text-sm text-red-300">{message}</p>}<button onClick={onBack} className="mt-4 w-full text-sm text-blue-300">Wróć</button>
  </div>;
}
