import { useEffect, useRef, useState } from 'react';
import { closeExternalAccountPopup, getElectronIpc, openExternalAccountUrl } from '../services/electron';

export type CentralUser = { email: string; name?: string | null };
export type CentralStart = { handle: string; displayCode: string; expiresAt: number; url: string };
export type CentralTab = 'login' | 'register' | 'reset';
export type TrustedCentralDevice = { deviceId: string; kind: 'desktop' | 'mobile'; name: string; createdAt: number; lastSeen: number };
export type TrustedDeviceLimits = { desktop: number | null; mobile: number | null };

export function useCentralSignIn(apiUrl: string, origin: string, deviceId: string, onAuthenticated: (user: CentralUser) => void) {
  const [tab, setTab] = useState<CentralTab>('login');
  const [centralEmail, setCentralEmail] = useState('');
  const [centralPassword, setCentralPassword] = useState('');
  const [start, setStart] = useState<CentralStart | null>(null);
  const [user, setUser] = useState<CentralUser | null>(null);
  const [needsLink, setNeedsLink] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [desktopSecret, setDesktopSecret] = useState('');
  const [newLocalPassword, setNewLocalPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [info, setInfo] = useState('');
  const polling = useRef(false);
  const autoFinished = useRef('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [deviceLimitReached, setDeviceLimitReached] = useState(false);
  const [trustedDevices, setTrustedDevices] = useState<TrustedCentralDevice[]>([]);
  const [deviceLimits, setDeviceLimits] = useState<TrustedDeviceLimits>({ desktop: null, mobile: null });
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [deviceFreed, setDeviceFreed] = useState(false);

  async function loadTrustedDevices(handle: string) {
    setDevicesLoading(true);
    setDevicesError('');
    try {
      const { response, payload } = await post('/api/central-account/handoff/devices', { handle });
      if (!response.ok) {
        setDevicesError(payload.error || `Nie udało się pobrać listy urządzeń (HTTP ${response.status}).`);
        return;
      }
      if (Array.isArray(payload.devices)) {
        setTrustedDevices(payload.devices as TrustedCentralDevice[]);
        if (payload.deviceLimits) setDeviceLimits(payload.deviceLimits as TrustedDeviceLimits);
      }
    } catch {
      setDevicesError('Błąd połączenia podczas pobierania listy urządzeń.');
    } finally {
      setDevicesLoading(false);
    }
  }

  async function revokeTrustedDevice(targetDeviceId: string) {
    if (!start) return;
    setRevokingDeviceId(targetDeviceId);
    setMessage('');
    try {
      const { response, payload } = await post('/api/central-account/handoff/devices/revoke', { handle: start.handle, deviceId: targetDeviceId });
      if (!response.ok) throw new Error(payload.error || 'Nie udało się usunąć urządzenia.');
      const nextDevices = Array.isArray(payload.devices) ? (payload.devices as TrustedCentralDevice[]) : [];
      const nextLimits = (payload.deviceLimits as TrustedDeviceLimits | undefined) || deviceLimits;
      setTrustedDevices(nextDevices);
      setDeviceLimits(nextLimits);
      const desktopCount = nextDevices.filter(d => d.kind === 'desktop').length;
      if (nextLimits.desktop === null || desktopCount < nextLimits.desktop) {
        setDeviceFreed(true);
        setInfo('Urządzenie zostało usunięte. Trwa logowanie…');
        await finish();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie udało się usunąć urządzenia.');
    } finally {
      setRevokingDeviceId(null);
    }
  }

  function resetToLogin() {
    autoFinished.current = '';
    setStart(null);
    setUser(null);
    setNeedsLink(false);
    setNeedsMfa(false);
    setMfaCode('');
    setDeviceLimitReached(false);
    setTrustedDevices([]);
    setDevicesError('');
    setDeviceFreed(false);
    setMessage('');
    setInfo('');
  }

  async function post(path: string, body: object, localToken?: string) {
    const response = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(localToken ? { authorization: `Bearer ${localToken}` } : {}) },
      body: JSON.stringify(body),
      redirect: 'error'
    });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({error:'Lokalny serwer aplikacji nie odpowiedział prawidłowo. Uruchom ponownie aplikację deweloperską.'}));
    return { response, payload };
  }

  function finishSession(payload: { token?: string; user?: CentralUser }) {
    if (typeof payload.token !== 'string' || !payload.user?.email) throw new Error('Serwer zwrócił nieprawidłową sesję.');
    try { sessionStorage.removeItem('eteczka_hide_hello_signin'); } catch { /* ignore */ }
    localStorage.setItem('eteczka_auth_token', payload.token);
    setPassword('');
    setCentralPassword('');
    onAuthenticated(payload.user);
    void getElectronIpc()?.invoke('eteczka-show-main-window').catch(() => undefined);
  }

  async function submitDirect() {
    setBusy(true); setMessage(''); setInfo('');
    try {
      if (tab === 'register') {
        const { response, payload } = await post('/api/central-account/register', { email: centralEmail, password: centralPassword });
        if (!response.ok) throw new Error(payload.error || 'Nie udało się utworzyć konta.');
        setCentralPassword('');
        setInfo(payload.message || 'Sprawdź pocztę i kliknij link potwierdzający.');
        return;
      }
      if (tab === 'reset') {
        const { response, payload } = await post('/api/central-account/request-password-reset', { email: centralEmail });
        if (!response.ok) throw new Error(payload.error || 'Nie udało się wysłać wiadomości.');
        setInfo(payload.message || 'Jeśli konto istnieje, wysłaliśmy link do zmiany hasła.');
        return;
      }
      const { response, payload } = await post('/api/central-account/credentials', { email: centralEmail, password: centralPassword });
      if (!response.ok || !payload.handle || !payload.user?.email) throw new Error(payload.error || 'Nie udało się zalogować.');
      setCentralPassword('');
      setStart(payload as CentralStart);
      setUser(payload.user as CentralUser);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operacja nie powiodła się.');
    } finally {
      setBusy(false);
    }
  }

  async function beginBrowser(embedBounds?: { x: number; y: number; width: number; height: number }) {
    setBusy(true); setMessage(''); setInfo(''); setNeedsLink(false); setUser(null);
    try {
      const { response, payload } = await post('/api/central-account/handoff/start', {});
      if (!response.ok || !payload.handle || !payload.url) throw new Error(payload.error || 'Nie udało się rozpocząć logowania.');
      const googleUrl = new URL(payload.url);
      googleUrl.searchParams.set('login', 'google');
      payload.url = googleUrl.href;
      setStart(payload as CentralStart);
      if (!embedBounds) {
        await openExternalAccountUrl(payload.url, origin);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie udało się rozpocząć logowania.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!start || user) return;
    let active = true;
    const check = async () => {
      if (polling.current) return;
      if (Date.now() >= start.expiresAt) { if (active) { setMessage('Kod wygasł. Rozpocznij logowanie ponownie.'); setStart(null); } return; }
      polling.current = true;
      try {
        const { response, payload } = await post('/api/central-account/handoff/poll', { handle: start.handle });
        if (!response.ok) throw new Error(payload.error || 'Błąd połączenia.');
        if (active && payload.status === 'approved' && payload.user?.email) {
          setUser(payload.user);
          closeExternalAccountPopup();
          void getElectronIpc()?.invoke('eteczka-show-main-window').catch(() => undefined);
        }
      } catch {
        if (active) setMessage('Nie udało się sprawdzić logowania. Próba zostanie ponowiona.');
      } finally {
        polling.current = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [start, user]);

  async function finish() {
    if (!start) return; setBusy(true); setMessage(''); setDeviceLimitReached(false);
    try {
      const { response, payload } = await post('/api/central-account/handoff/finish', { handle: start.handle, createNew: true, mfaCode, deviceId, deviceName: 'MojaTeczka Desktop' });
      if (response.status === 409 && ['LOCAL_LINK_REQUIRED', 'LOCAL_ACCOUNT_EXISTS'].includes(payload.code)) { setNeedsLink(true); return; }
      if (response.status === 401 && payload.code === 'MFA_REQUIRED') { setNeedsMfa(true); setMessage(payload.error); return; }
      if (payload?.code === 'DEVICE_LIMIT_REACHED') {
        setDeviceLimitReached(true);
        setDeviceFreed(false);
        if (Array.isArray(payload.devices)) {
          setTrustedDevices(payload.devices as TrustedCentralDevice[]);
          if (payload.deviceLimits) setDeviceLimits(payload.deviceLimits as TrustedDeviceLimits);
        } else {
          void loadTrustedDevices(start.handle);
        }
      }
      if (!response.ok) throw new Error(payload.error || 'Nie udało się zalogować.');
      finishSession(payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zalogować.'); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!user || !start || autoFinished.current === start.handle) return;
    autoFinished.current = start.handle;
    void finish();
  }, [user, start]);

  async function linkExisting() {
    if (!start) return; setBusy(true); setMessage('');
    try {
      const local = await post('/api/auth/login', { email, password, deviceId, deviceName: 'MojaTeczka Desktop' });
      if (!local.response.ok || typeof local.payload.token !== 'string') throw new Error(local.payload.error || 'Nie udało się zalogować lokalnie.');
      const linked = await post('/api/central-account/handoff/link', { handle: start.handle }, local.payload.token);
      if (!linked.response.ok) throw new Error(linked.payload.error || 'Nie udało się połączyć kont.');
      finishSession(local.payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się połączyć kont.'); } finally { setBusy(false); }
  }

  async function createLocal() {
    if (!start) return; setBusy(true); setMessage(''); setDeviceLimitReached(false);
    try {
      const { response, payload } = await post('/api/central-account/handoff/create-local', { handle: start.handle, localPassword: newLocalPassword, deviceId, deviceName: 'MojaTeczka Desktop' });
      if (payload?.code === 'DEVICE_LIMIT_REACHED') { setDeviceLimitReached(true); setDeviceFreed(false); void loadTrustedDevices(start.handle); }
      if (!response.ok) throw new Error(payload.error || 'Nie udało się utworzyć konta.');
      setNewLocalPassword('');
      finishSession(payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się utworzyć konta.'); } finally { setBusy(false); }
  }

  async function linkDesktop() {
    if (!start) return; setBusy(true); setMessage(''); setDeviceLimitReached(false);
    try {
      const { response, payload } = await post('/api/central-account/handoff/link-desktop', { handle: start.handle, secret: desktopSecret, deviceId, deviceName: 'MojaTeczka Desktop' });
      if (payload?.code === 'DEVICE_LIMIT_REACHED') { setDeviceLimitReached(true); setDeviceFreed(false); void loadTrustedDevices(start.handle); }
      if (!response.ok) throw new Error(payload.error || 'Nie udało się połączyć danych.');
      setDesktopSecret('');
      finishSession(payload);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się połączyć danych.'); } finally { setBusy(false); }
  }

  return {
    tab, setTab, centralEmail, setCentralEmail, centralPassword, setCentralPassword,
    start, user, needsLink, email, setEmail, password, setPassword,
    desktopSecret, setDesktopSecret, newLocalPassword, setNewLocalPassword,
    busy, message, info, needsMfa, mfaCode, setMfaCode, deviceLimitReached,
    trustedDevices, deviceLimits, devicesLoading, devicesError, revokingDeviceId, deviceFreed,
    submitDirect, beginBrowser, finish, linkExisting, createLocal, linkDesktop, revokeTrustedDevice, resetToLogin
  };
}
