import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import os from 'os';
import { pairedDevicesFile } from '../config/paths';
import { authSecret } from '../security/authSecret';

const AUTH_SECRET = authSecret();

type PairedDevice = { id: string; name: string; tokenHash: string; createdAt: string; lastSeenAt: string };

function loadPairedDevices(): PairedDevice[] {
  try { return JSON.parse(fs.readFileSync(pairedDevicesFile, 'utf8')); }
  catch { return []; }
}

let pairedDevices = loadPairedDevices();
let pairingCode = createPairingCode();
let pairingExpiresAt = Date.now() + 10 * 60 * 1000;
const pairingAttempts = new Map<string, number>();

function savePairedDevices() {
  const temporaryFile = `${pairedDevicesFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(pairedDevices, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryFile, pairedDevicesFile);
}

function createPairingCode() { return crypto.randomInt(10_000_000, 100_000_000).toString(); }

function rotatePairingCode() {
  pairingCode = createPairingCode();
  pairingExpiresAt = Date.now() + 10 * 60 * 1000;
  pairingAttempts.clear();
}

function isLoopback(request: express.Request) {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function requireLocalDesktop(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (isLoopback(request)) return next();
  response.status(403).json({ error: 'Ta funkcja jest dostępna tylko z aplikacji desktopowej.' });
}

export function requireAccess(request: express.Request, response: express.Response, next: express.NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (token) {
    const account = verifyAccountToken(token);
    if (account) {
      response.locals.userId = account.userId;
      response.locals.billingOwnerKey = `user:${account.userId}`;
      return next();
    }
  }
  if (isLoopback(request)) {
    response.locals.billingOwnerKey = 'desktop-local';
    return next();
  }
  if (!token) return response.status(401).json({ error: 'Brak autoryzacji urządzenia.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const device = pairedDevices.find(item => item.tokenHash === tokenHash);
  if (!device) return response.status(401).json({ error: 'Urządzenie nie jest sparowane.' });
  device.lastSeenAt = new Date().toISOString();
  savePairedDevices();
  response.locals.billingOwnerKey = `device:${device.id}`;
  next();
}

function verifyAccountToken(token: string) {
  if (!AUTH_SECRET) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const [rawUserId, rawExpiry] = payload.split('.');
  const userId = Number(rawUserId);
  const expiresAt = Number(rawExpiry);
  return Number.isInteger(userId) && userId > 0 && Number.isFinite(expiresAt) && expiresAt > Date.now() ? { userId } : null;
}

export function registerPairingRoutes(app: express.Express) {
  app.get('/api/pairing-code', requireLocalDesktop, (_req, res) => {
    if (Date.now() >= pairingExpiresAt) rotatePairingCode();
    res.json({ code: pairingCode, expiresAt: pairingExpiresAt });
  });

  app.get('/api/network-info', requireLocalDesktop, (_req, res) => {
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter((item): item is os.NetworkInterfaceInfo => item !== undefined && item.family === 'IPv4' && !item.internal)
      .map(item => item.address)
      .filter(address => { const [first = -1, second = -1] = address.split('.').map(Number); return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168); });
    res.json({ addresses, port: Number(process.env.PORT || 3000) });
  });

  app.post('/api/pair', (req, res) => {
    const address = req.socket.remoteAddress || 'unknown';
    const attempts = pairingAttempts.get(address) || 0;
    if (attempts >= 5) { rotatePairingCode(); return res.status(429).json({ error: 'Za dużo nieudanych prób. Na komputerze wyświetlono nowy kod.' }); }
    if (Date.now() >= pairingExpiresAt || req.body?.pairingCode !== pairingCode) { pairingAttempts.set(address, attempts + 1); return res.status(401).json({ error: 'Nieprawidłowy lub wygasły kod parowania.' }); }
    const accessToken = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    pairedDevices.push({ id: crypto.randomUUID(), name: String(req.body?.deviceName || 'Telefon').slice(0, 64), tokenHash: crypto.createHash('sha256').update(accessToken).digest('hex'), createdAt: now, lastSeenAt: now });
    savePairedDevices(); rotatePairingCode();
    res.status(201).json({ accessToken });
  });
}
