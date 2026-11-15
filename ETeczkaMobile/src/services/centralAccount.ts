import { DeviceEventEmitter } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'eteczka_central_account_session_v1';
export type CentralAccountUser = { id: string; email: string; name: string | null };
type CentralSession = { origin: string; token: string; expiresAt: number; user: CentralAccountUser };

// This client is not wired into the UI yet. Local documents and local pairing
// credentials are intentionally separate from the central account session.
export function centralAccountOrigin(configured: string): string {
  const value = new URL(configured);
  if (value.protocol !== 'https:' || value.username || value.password || value.pathname !== '/' || value.search || value.hash) throw new Error('Konto centralne wymaga pełnego adresu HTTPS bez ścieżki.');
  return value.origin;
}

async function post<T>(origin: string, endpoint: string, body: object, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${centralAccountOrigin(origin)}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Operacja nie powiodła się.');
    return data as T;
  } finally { clearTimeout(timer); }
}

async function saveSession(origin: string, session: Omit<CentralSession, 'origin'>): Promise<CentralAccountUser> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(session.token) || !Number.isFinite(session.expiresAt) || !session.user?.id || !session.user.email) throw new Error('Serwer zwrócił nieprawidłową sesję.');
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ ...session, origin: centralAccountOrigin(origin) }));
  return session.user;
}

export async function registerCentralAccount(origin: string, email: string, password: string) { return post<{ message: string }>(origin, '/register', { email, password }); }
export async function loginCentralAccount(origin: string, email: string, password: string) { return saveSession(origin, await post<Omit<CentralSession, 'origin'>>(origin, '/login', { email, password })); }
export async function requestCentralPasswordReset(origin: string, email: string) { return post<{ message: string }>(origin, '/request-password-reset', { email }); }
export async function resendCentralVerification(origin: string, email: string) { return post<{ message: string }>(origin, '/resend-verification', { email }); }
export async function getCentralGoogleChallenge(origin: string) { return post<{ nonce: string }>(origin, '/google-challenge', {}); }
export async function loginCentralWithGoogle(origin: string, credential: string, nonce: string) { return saveSession(origin, await post<Omit<CentralSession, 'origin'>>(origin, '/google', { credential, nonce })); }
export async function linkCentralGoogle(origin: string, credential: string, nonce: string) {
  const session = await getCentralSession(origin); if (!session) throw new Error('Najpierw zaloguj się na konto E‑Teczki.');
  await post(origin, '/link-google', { credential, nonce }, session.token);
}

export async function getCentralSession(origin: string): Promise<CentralSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY); if (!raw) return null;
  try { const session = JSON.parse(raw) as CentralSession; if (session.origin !== centralAccountOrigin(origin) || session.expiresAt <= Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(session.token)) return null; return session; }
  catch { return null; }
}

export async function refreshCentralUser(origin: string): Promise<CentralAccountUser | null> {
  const session = await getCentralSession(origin); if (!session) return null;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${centralAccountOrigin(origin)}/me`, { headers: { authorization: `Bearer ${session.token}` }, signal: controller.signal, redirect: 'error' });
    if (response.status === 401) { await SecureStore.deleteItemAsync(SESSION_KEY); return null; }
    if (!response.ok) throw new Error('Nie udało się sprawdzić sesji.');
    const user = await response.json() as CentralAccountUser;
    if (user.id !== session.user.id || !user.email) throw new Error('Serwer zwrócił nieprawidłowe dane konta.');
    return user;
  } finally { clearTimeout(timer); }
}

export async function logoutCentralAccount(origin: string) {
  const session = await getCentralSession(origin);
  // Keep the local credential if the server cannot revoke it, so the user can retry.
  if (session) await post(origin, '/logout', {}, session.token);
  await SecureStore.deleteItemAsync(SESSION_KEY);
  DeviceEventEmitter.emit('eteczka-central-logout');
}
