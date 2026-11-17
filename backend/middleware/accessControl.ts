import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import os from 'os';
import { pairedDevicesFile } from '../config/paths';
import { authSecret } from '../security/authSecret';

const AUTH_SECRET = authSecret();

type PairedDevice = { id: string; name: string; tokenHash: string; createdAt: string; lastSeenAt: string; ownerId?: number; ownerKey?: string };

function loadPairedDevices(): PairedDevice[] {
  try { return JSON.parse(fs.readFileSync(pairedDevicesFile, 'utf8')); }
  catch { return []; }
}

let pairedDevices = loadPairedDevices();
let pairingCode = createPairingCode();
let pairingExpiresAt = Date.now() + 10 * 60 * 1000;
let pairingOwner: { ownerId?: number; ownerKey: string; mobileLimit: number; replaceDeviceId?:string } = { ownerKey: 'desktop-local', mobileLimit: 1 };
const pairingAttempts = new Map<string, number>();
let accountSessionIsActive: ((token: string, userId: number) => Promise<boolean>) | null = null;

export function configureAccountSessionValidator(validator: (token: string, userId: number) => Promise<boolean>) {
  accountSessionIsActive = validator;
}

function savePairedDevices(devices = pairedDevices) {
  const temporaryFile = `${pairedDevicesFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(devices, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, pairedDevicesFile);
}

function createPairingCode() { return crypto.randomInt(10_000_000, 100_000_000).toString(); }

function rotatePairingCode() {
  pairingCode = createPairingCode();
  pairingExpiresAt = Date.now() + 10 * 60 * 1000;
  pairingAttempts.clear();
  pairingOwner.replaceDeviceId=undefined;
}

function isLoopback(request: express.Request) {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function requireLocalDesktop(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (isLoopback(request)) return next();
  response.status(403).json({ error: 'Ta funkcja jest dostępna tylko z aplikacji desktopowej.' });
}

export async function requireAccess(request: express.Request, response: express.Response, next: express.NextFunction) {
  // Stripe redirects the browser back without the app's Authorization header.
  // The confirmation endpoint validates the Checkout Session itself, so it is
  // safe to let that one GET through the device gate.
  if (request.method === 'GET' && request.path === '/billing/confirm') return next();
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (token) {
    const account = verifyAccountToken(token);
    if (account) {
      if (!accountSessionIsActive) return response.status(503).json({ error: 'Weryfikacja sesji jest niedostępna.' });
      try {
        if (!await accountSessionIsActive(token, account.userId)) return response.status(401).json({ error: 'Sesja wygasła lub została wylogowana.' });
      } catch { return response.status(503).json({ error: 'Nie udało się sprawdzić sesji.' }); }
      response.locals.userId = account.userId;
      response.locals.billingOwnerKey = `user:${account.userId}`;
      return next();
    }
  }
  if (isLoopback(request)) {
    return response.status(401).json({ error: 'Zaloguj się na konto E‑Teczki, aby uzyskać dostęp do dokumentów.' });
  }
  if (!token) return response.status(401).json({ error: 'Brak autoryzacji urządzenia.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const device = pairedDevices.find(item => item.tokenHash === tokenHash);
  if (!device) return response.status(401).json({ error: 'Urządzenie nie jest sparowane.' });
  device.lastSeenAt = new Date().toISOString();
  savePairedDevices();
  if (device.ownerId) response.locals.userId = device.ownerId;
  response.locals.billingOwnerKey = device.ownerKey || `device:${device.id}`;
  next();
}

export function verifyAccountToken(token: string) {
  if (!AUTH_SECRET) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const signatureBytes = Buffer.from(signature, 'utf8'); const expectedBytes = Buffer.from(expected, 'utf8');
  if (signatureBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(signatureBytes, expectedBytes)) return null;
  const [rawUserId, rawExpiry] = payload.split('.');
  const userId = Number(rawUserId);
  const expiresAt = Number(rawExpiry);
  return Number.isInteger(userId) && userId > 0 && Number.isFinite(expiresAt) && expiresAt > 0 ? { userId } : null;
}

export function registerPairingRoutes(app: express.Express, mobileLimit: (ownerKey: string) => Promise<number> = async () => 1) {
  app.get('/api/pairing-code', requireLocalDesktop, requireAccess, async (_req, res) => {
    const ownerKey = String(res.locals.billingOwnerKey || 'desktop-local'); const ownerId = res.locals.userId ? Number(res.locals.userId) : undefined;
    const limit = await mobileLimit(ownerKey);
    if (Date.now() >= pairingExpiresAt || pairingOwner.ownerKey !== ownerKey) rotatePairingCode();
    pairingOwner = { ownerId, ownerKey, mobileLimit: limit, replaceDeviceId:pairingOwner.ownerKey===ownerKey?pairingOwner.replaceDeviceId:undefined };
    res.json({ code: pairingCode, expiresAt: pairingExpiresAt });
  });

  app.get('/api/network-info', requireLocalDesktop, (_req, res) => {
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter((item): item is os.NetworkInterfaceInfo => item !== undefined && item.family === 'IPv4' && !item.internal)
      .map(item => item.address)
      .filter(address => { const [first = -1, second = -1] = address.split('.').map(Number); return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168); });
    addresses.sort((a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')) || Number(a.startsWith('172.20.')) - Number(b.startsWith('172.20.')));
    res.json({ addresses, port: 3443 });
  });
  app.get('/api/pairing-status', requireLocalDesktop, requireAccess, async (_req, res) => {
    const limit = await mobileLimit(String(res.locals.billingOwnerKey || 'desktop-local'));
    const devices = pairedDevices.filter(device => (device.ownerKey || 'desktop-local') === String(res.locals.billingOwnerKey || 'desktop-local'));
    res.json({ devices:devices.map(({id,name,createdAt,lastSeenAt})=>({id,name,createdAt,lastSeenAt})), pairedDevices: devices.length, mobileDeviceLimit: limit, phoneConnected: devices.some((device) => Date.now() - Date.parse(device.lastSeenAt) < 30_000) });
  });

  app.post('/api/pairing-replacement', requireLocalDesktop, requireAccess, async (req,res)=>{
    const ownerKey=String(res.locals.billingOwnerKey||'desktop-local');const device=pairedDevices.find(item=>item.id===req.body?.deviceId&&(item.ownerKey||'desktop-local')===ownerKey);
    if(!device)return res.status(404).json({error:'Nie znaleziono telefonu przypisanego do tego konta.'});
    const limit=await mobileLimit(ownerKey);rotatePairingCode();pairingOwner={ownerKey,ownerId:Number(res.locals.userId)||undefined,mobileLimit:limit,replaceDeviceId:device.id};
    return res.json({code:pairingCode,expiresAt:pairingExpiresAt,replaces:device.name});
  });

  app.post('/api/pair', (req, res) => {
    const address = req.socket.remoteAddress || 'unknown';
    const attempts = pairingAttempts.get(address) || 0;
    if (attempts >= 5) { rotatePairingCode(); return res.status(429).json({ error: 'Za dużo nieudanych prób. Na komputerze wyświetlono nowy kod.' }); }
    if (Date.now() >= pairingExpiresAt || req.body?.pairingCode !== pairingCode) { pairingAttempts.set(address, attempts + 1); return res.status(401).json({ error: 'Nieprawidłowy lub wygasły kod parowania.' }); }
    // Individual plans pair one mobile device per archive owner. Multi-device
    // business/family entitlements must be enforced here when those plans ship.
    const trustedPhones = pairedDevices.filter(device => (device.ownerKey || 'desktop-local') === pairingOwner.ownerKey);
    const replaced=trustedPhones.find(device=>device.id===pairingOwner.replaceDeviceId);
    if (trustedPhones.length-(replaced?1:0) >= pairingOwner.mobileLimit) return res.status(403).json({ code: 'MOBILE_DEVICE_LIMIT_REACHED', error: `Osiągnięto limit zaufanych telefonów (${pairingOwner.mobileLimit}). Aby ponownie sparować ten telefon lub zmienić telefon, na komputerze otwórz okno parowania i wybierz „Zastąp parowanie” przy zapisanym urządzeniu.` });
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const updated=pairedDevices.filter(device=>device!==replaced);
    updated.push({ id: crypto.randomUUID(), name: String(req.body?.deviceName || 'Telefon').slice(0, 64), tokenHash: crypto.createHash('sha256').update(accessToken).digest('hex'), createdAt: now, lastSeenAt: now, ownerId: pairingOwner.ownerId, ownerKey: pairingOwner.ownerKey });
    try{savePairedDevices(updated);}catch{return res.status(503).json({error:'Nie udało się zapisać parowania. Poprzedni telefon pozostał połączony.'});}
    pairedDevices=updated;rotatePairingCode();
    res.status(201).json({ accessToken });
  });
}
