import { currentMobileAccount, selectMobileProfile, closeMobileProfile } from './mobileProfile';
import { DeviceEventEmitter } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const SESSION_KEY = 'mojateczka_central_account_session_v1';
const DEVICE_KEY = 'mojateczka_central_device_v1';
const PLAN_KEY = 'mojateczka_central_plan_v1';
export type CentralPlanName = 'free' | 'standard' | 'premium' | 'family' | 'business';
export type CentralPlan = { accountId:string;deviceId:string;kind:'mobile';plan:CentralPlanName;expiresAt:number;validUntil:number|null };
export type CentralPlanUsage={plan:CentralPlanName;documents:{used:number;reservedOffline?:number;limit:number|null};tags:{used:number;reservedOffline?:number;limit:number|null};cameraScan:{used:number;reservedOffline?:number;limit:number|null};printerScan:{used:number;reservedOffline?:number;limit:number|null};merge:{used:number;reservedOffline?:number;limit:number|null}};
export async function getCentralPlanUsage(origin:string):Promise<CentralPlanUsage>{const session=await getCentralSession(origin);if(!session)throw new Error('Zaloguj się na konto.');const device=await mobileDevice(session.user.id);return post(origin,'/ledger/status',{},device.credential);}
async function mobileDevice(userId:string) {
  const key=`${DEVICE_KEY}_${userId}`;const stored=await SecureStore.getItemAsync(key);if(stored)return JSON.parse(stored) as {deviceId:string;credential:string};
  const bytes=await Crypto.getRandomBytesAsync(32);const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';let bits=0,value=0,credential='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=6){bits-=6;credential+=alphabet[(value>>>bits)&63];}}if(bits)credential+=alphabet[(value<<(6-bits))&63];
  const device={deviceId:Crypto.randomUUID(),credential};await SecureStore.setItemAsync(key,JSON.stringify(device));return device;
}
const VALID_PLANS: readonly CentralPlanName[] = ['free', 'standard', 'premium', 'family', 'business'];
function decodeBase64UrlUtf8(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4));
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  return binary;
}
async function savePlan(origin:string,userId:string,signed:{payload:string}) {
  const lease=JSON.parse(decodeBase64UrlUtf8(signed.payload)) as CentralPlan;
  const device=await mobileDevice(userId);if(lease.accountId!==userId||lease.deviceId!==device.deviceId||lease.kind!=='mobile'||!VALID_PLANS.includes(lease.plan)||lease.expiresAt<=Date.now()||lease.expiresAt>Date.now()+86400000+600000)throw new Error('Nieprawidłowe uprawnienia konta.');
  // Received over HTTPS and kept in OS-protected SecureStore; never trust purchase fields from the UI.
  await SecureStore.setItemAsync(`${PLAN_KEY}_${userId}`,JSON.stringify({origin:centralAccountOrigin(origin),lease}));return lease;
}
export async function refreshCentralPlan(origin:string):Promise<CentralPlan|null>{
  const session=await getCentralSession(origin);if(!session)return null;const device=await mobileDevice(session.user.id);
  try{return await savePlan(origin,session.user.id,await post(origin,'/entitlements/refresh',{},device.credential));}catch(error){if([401,403].includes(Number((error as Error&{status?:number}).status))){await closeMobileProfile().catch(()=>undefined);await SecureStore.deleteItemAsync(`${PLAN_KEY}_${session.user.id}`);await SecureStore.deleteItemAsync(SESSION_KEY);DeviceEventEmitter.emit('mojateczka-central-logout');}throw error;}
}
export async function getCachedCentralPlan(origin:string):Promise<CentralPlan|null>{const session=await getCentralSession(origin);if(!session)return null;try{const raw=await SecureStore.getItemAsync(`${PLAN_KEY}_${session.user.id}`);const cached=raw?JSON.parse(raw):null;return cached?.origin===centralAccountOrigin(origin)&&cached.lease?.expiresAt>Date.now()&&cached.lease?.accountId===session.user.id?cached.lease:null;}catch{return null;}}
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
    if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'Operacja nie powiodła się.'),{status:response.status,code:data.code,conflictId:data.conflictId,devices:data.devices});
    return data as T;
  } finally { clearTimeout(timer); }
}

async function saveSession(origin: string, session: Omit<CentralSession, 'origin'>): Promise<CentralAccountUser> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(session.token) || !Number.isFinite(session.expiresAt) || !session.user?.id || !session.user.email) throw new Error('Serwer zwrócił nieprawidłową sesję.');
  const device=await mobileDevice(session.user.id);
  try{await savePlan(origin,session.user.id,await post(origin,'/entitlements/register',{...device,kind:'mobile',name:'MojaTeczka Mobile'},session.token));}catch(error){throw error;}
  if(currentMobileAccount()!==session.user.id)DeviceEventEmitter.emit('mojateczka-account-switch-start');
  try{await selectMobileProfile(session.user.id,session.user.email);await SecureStore.setItemAsync(SESSION_KEY,JSON.stringify({...session,origin:centralAccountOrigin(origin)}));}catch(error){DeviceEventEmitter.emit('mojateczka-account-switch-failed',error instanceof Error?error.message:'Nie udało się zmienić konta.');throw error;}
  DeviceEventEmitter.emit('mojateczka-central-session-changed');
  return session.user;
}

export async function registerCentralAccount(origin: string, email: string, password: string) { return post<{ message: string }>(origin, '/register', { email, password }); }
export async function loginCentralAccount(origin: string, email: string, password: string) { return saveSession(origin, await post<Omit<CentralSession, 'origin'>>(origin, '/login', { email, password })); }
export async function requestCentralPasswordReset(origin: string, email: string) { return post<{ message: string }>(origin, '/request-password-reset', { email }); }
export async function resendCentralVerification(origin: string, email: string) { return post<{ message: string }>(origin, '/resend-verification', { email }); }
export async function getCentralGoogleChallenge(origin: string) { return post<{ nonce: string }>(origin, '/google-challenge', {}); }
export async function loginCentralWithGoogle(origin: string, credential: string, nonce: string) { return saveSession(origin, await post<Omit<CentralSession, 'origin'>>(origin, '/google', { credential, nonce })); }
export async function linkCentralGoogle(origin: string, credential: string, nonce: string) {
  const session = await getCentralSession(origin); if (!session) throw new Error('Najpierw zaloguj się na konto MojejTeczki.');
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
    if (response.status === 401) {
      await closeMobileProfile().catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_KEY);
      DeviceEventEmitter.emit('mojateczka-central-logout');
      return null;
    }
    if (!response.ok) throw new Error('Nie udało się sprawdzić sesji.');
    const user = await response.json() as CentralAccountUser;
    if (user.id !== session.user.id || !user.email) throw new Error('Serwer zwrócił nieprawidłowe dane konta.');
    await refreshCentralPlan(origin);
    return user;
  } finally { clearTimeout(timer); }
}

export async function logoutCentralAccount(origin: string) {
  const session = await getCentralSession(origin);
  DeviceEventEmitter.emit('mojateczka-account-switch-start');
  await closeMobileProfile().catch(() => undefined);
  await SecureStore.deleteItemAsync(SESSION_KEY);
  DeviceEventEmitter.emit('mojateczka-central-logout');
  if (session) {
    void post(origin, '/logout', {}, session.token).catch(() => undefined);
  }
}

export async function deleteCentralAccount(origin: string) {
  const session = await getCentralSession(origin);
  if (!session) throw new Error('Najpierw zaloguj się na konto MojejTeczki.');
  await post(origin, '/delete-account', {}, session.token);
  DeviceEventEmitter.emit('mojateczka-account-switch-start');
  await closeMobileProfile();
  await SecureStore.deleteItemAsync(SESSION_KEY);
  DeviceEventEmitter.emit('mojateczka-central-logout');
}

export function privacyPolicyUrl(origin: string): string {
  return `${centralAccountOrigin(origin)}/privacy`;
}

export function desktopDownloadPageUrl(origin: string): string {
  return `${centralAccountOrigin(origin)}/pc`;
}

export async function sendDesktopDownloadEmail(origin: string): Promise<{ ok: boolean; email: string; pcUrl: string }> {
  const session = await getCentralSession(origin);
  if (!session) throw new Error('Najpierw zaloguj się na konto MojejTeczki.');
  return post<{ ok: boolean; email: string; pcUrl: string }>(origin, '/desktop-download/email', {}, session.token);
}

export type CentralPromotion = { id: string; name: string; plan: Exclude<CentralPlanName, 'free'>; interval: 'monthly' | 'yearly'; percent: number; startsAt: string; endsAt: string; enabled: boolean };
export type CentralCatalog = { plans: Record<CentralPlanName, { name: string; monthly: number; yearly: number }>; promotions: CentralPromotion[] };

export async function getCentralCatalog(origin: string): Promise<CentralCatalog | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${centralAccountOrigin(origin)}/catalog`, { signal: controller.signal, redirect: 'error' });
    return res.ok ? ((await res.json()) as CentralCatalog) : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function activePromotions(catalog: CentralCatalog, now = Date.now()): CentralPromotion[] {
  const best = new Map<string, CentralPromotion>();
  for (const promo of catalog.promotions || []) {
    if (!promo.enabled) continue;
    const start = Date.parse(promo.startsAt); const end = Date.parse(promo.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now >= end) continue;
    const key = `${promo.plan}:${promo.interval}`;
    const prev = best.get(key);
    if (!prev || promo.percent > prev.percent || (promo.percent === prev.percent && promo.id.localeCompare(prev.id) < 0)) best.set(key, promo);
  }
  return Array.from(best.values()).sort((a, b) => b.percent - a.percent);
}

/** Changing accounts preserves encrypted vaults and does not require the old vault PIN. */
export async function chooseAnotherMobileAccount(origin:string){
 const session=await getCentralSession(origin);DeviceEventEmitter.emit('mojateczka-account-switch-start');
 try{await closeMobileProfile();await SecureStore.deleteItemAsync(SESSION_KEY);DeviceEventEmitter.emit('mojateczka-central-logout');}
 catch(error){DeviceEventEmitter.emit('mojateczka-account-switch-failed',error instanceof Error?error.message:'Nie udało się zmienić konta.');throw error;}
 if(session)void post(origin,'/logout',{},session.token).catch(()=>undefined);
}

