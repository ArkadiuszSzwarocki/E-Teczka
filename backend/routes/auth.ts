import { AccountMfaRequired, verifyAccountMfa } from '../services/accountMfa';
import { SESSION_DURATION_MS, ensureIdleSessionPolicy, activeSessionWhere, effectiveSessionExpiry } from '../services/sessionPolicy';
import { getCatalog } from '../services/planCatalog';
import crypto from 'crypto';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { authSecret } from '../security/authSecret';
import { centralEntitlement, hasCentralLink } from '../services/centralEntitlements';
import { getDevOverrides } from '../services/devOverrides';

const AUTH_SECRET = authSecret();
const DUMMY_HASH = `00000000000000000000000000000000:${'0'.repeat(128)}`;
const TRIVIAL_PASSWORDS = new Set(['12345678', '123456789', '1234567890', 'password', 'password1', 'qwerty123', 'admin123', 'eteczka123']);

type AttemptBucket = { count: number; lockedUntil: number; resetAt: number };
const loginAttempts = new Map<string, AttemptBucket>();

function attemptKey(req: express.Request, email: string) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `${ip}:${email}`;
}

function checkLoginRateLimit(key: string, now = Date.now()): number | null {
  const entry = loginAttempts.get(key);
  if (!entry) return null;
  if (entry.lockedUntil > now) return Math.ceil((entry.lockedUntil - now) / 1000);
  if (entry.resetAt <= now) {
    loginAttempts.delete(key);
    return null;
  }
  return null;
}

function recordLoginFailure(key: string, now = Date.now()) {
  const current = loginAttempts.get(key);
  const count = current && current.resetAt > now ? current.count + 1 : 1;
  const lockedUntil = count >= 5 ? now + Math.min(900_000, 60_000 * 2 ** (count - 5)) : 0;
  loginAttempts.set(key, { count, lockedUntil, resetAt: now + 900_000 });
}

function isStrongEnoughPassword(password: string, email: string): boolean {
  const lower = password.toLowerCase();
  if (TRIVIAL_PASSWORDS.has(lower)) return false;
  if (email && lower.includes(email.split('@')[0]) && email.split('@')[0].length >= 4 && lower === email.split('@')[0]) return false;
  if (/^(.)\1+$/.test(password)) return false;
  return true;
}



export function passwordHash(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${digest}`;
}

function passwordMatches(password: string, stored: string | null) {
  if (!stored) return false;
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function sessionToken(userId: number, expiresAt: Date) {
  const payload = `${userId}.${expiresAt.getTime()}.${crypto.randomBytes(16).toString('hex')}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

function validCredentials(body: unknown): body is { email: string; password: string } {
  if (!body || typeof body !== 'object') return false;
  const value = body as Record<string, unknown>;
  return typeof value.email === 'string' && value.email.trim().length >= 5 && value.email.length <= 255
    && typeof value.password === 'string' && value.password.length >= 8 && value.password.length <= 200;
}

export function createAuthRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ready=ensureIdleSessionPolicy(prisma);router.use(async(_req,res,next)=>{try{await ready;next();}catch{return res.status(503).json({error:'Nie udało się przygotować sesji.'});}});

  router.post('/register', async (request, response) => {
    if (!validCredentials(request.body)) return response.status(400).json({ error: 'Podaj poprawny e‑mail i hasło (minimum 8 znaków).' });
    const email = request.body.email.trim().toLowerCase();
    const key = attemptKey(request, `reg:${email}`);
    const bypassRate = getDevOverrides().bypassRateLimit;
    const retryAfter = bypassRate ? null : checkLoginRateLimit(key);
    if (retryAfter) {
      response.setHeader('Retry-After', String(retryAfter));
      return response.status(429).json({ error: `Zbyt wiele prób rejestracji. Spróbuj ponownie za ${retryAfter} s.` });
    }
    if (!isStrongEnoughPassword(request.body.password, email)) {
      return response.status(400).json({ error: 'Wybierz silniejsze hasło (unikaj prostych ciągów typu 12345678 lub nazwy konta).' });
    }
    try {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        recordLoginFailure(key);
        return response.status(409).json({ error: 'Konto z tym adresem już istnieje.' });
      }
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0], passwordHash: passwordHash(request.body.password) } });
      return response.status(201).json(await createSession(prisma, user.id, user.email, user.name, request.body));
    } catch { return response.status(500).json({ error: 'Nie udało się utworzyć konta.' }); }
  });

  router.post('/login', async (request, response) => {
    if (!validCredentials(request.body)) return response.status(400).json({ error: 'Podaj e‑mail i hasło.' });
    const email = request.body.email.trim().toLowerCase();
    const key = attemptKey(request, email);
    const bypassRate = getDevOverrides().bypassRateLimit;
    const retryAfter = bypassRate ? null : checkLoginRateLimit(key);
    if (retryAfter) {
      response.setHeader('Retry-After', String(retryAfter));
      return response.status(429).json({ error: `Zbyt wiele nieudanych prób logowania. Spróbuj ponownie za ${retryAfter} s.` });
    }
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = passwordMatches(request.body.password, user?.passwordHash ?? DUMMY_HASH) && Boolean(user);
    if (!valid || !user) {
      if (!bypassRate) recordLoginFailure(key);
      return response.status(401).json({ error: 'Nieprawidłowy e‑mail lub hasło.' });
    }
    loginAttempts.delete(key);
    try {
      return response.json(await createSession(prisma, user.id, user.email, user.name, request.body));
    } catch (error) {
      if (error instanceof AccountMfaRequired) return response.status(401).json({ code: error.code, error: error.message });
      if (error instanceof DeviceLimitError) return response.status(403).json({ error: error.message, code: 'DEVICE_LIMIT_REACHED', limit: error.limit });
      return response.status(500).json({ error: 'Nie udało się utworzyć sesji.' });
    }
  });

  router.post('/logout', async (request, response) => {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (token) await prisma.authSession.deleteMany({ where: { tokenHash: crypto.createHash('sha256').update(token).digest('hex') } });
    response.json({ success: true });
  });

  router.post('/activity',async(request,response)=>{
    const token=request.header('authorization')?.replace(/^Bearer\s+/i,'');if(!token)return response.status(401).json({error:'Brak aktywnej sesji.'});
    const now=new Date(),expiresAt=new Date(now.getTime()+SESSION_DURATION_MS);
    const result=await prisma.authSession.updateMany({where:{tokenHash:crypto.createHash('sha256').update(token).digest('hex'),...activeSessionWhere(now)},data:{expiresAt}});
    if(!result.count)return response.status(401).json({error:'Sesja wygasła. Zaloguj się ponownie.'});
    return response.json({expiresAt,serverNow:now,idleTimeoutMs:SESSION_DURATION_MS});
  });

  router.get('/me', async (request, response) => {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return response.status(401).json({ error: 'Brak aktywnej sesji.' });
    const session = await prisma.authSession.findFirst({ where: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), ...activeSessionWhere() }, include: { user: true } });
    const user = session?.user;
    if (!user) return response.status(401).json({ error: 'Sesja wygasła.' });
    response.json({ id: user.id, email: user.email, name: user.name, expiresAt: effectiveSessionExpiry(session.createdAt, session.expiresAt),serverNow:new Date(),idleTimeoutMs:SESSION_DURATION_MS });
  });

  return router;
}

export class DeviceLimitError extends Error { constructor(public readonly limit: number) { super(`Limit urządzeń dla tego planu został osiągnięty (${limit}). Wyloguj inne urządzenie albo wybierz wyższy plan.`); } }

export async function createSession(prisma: PrismaClient, userId: number, email: string, name: string | null, body?: Record<string, unknown>, authentication: 'standard' | 'trusted-hello' = 'standard') {
  // This mode is supplied internally only after verification of a registered device signature.
  if (authentication !== 'trusted-hello') verifyAccountMfa(userId, body?.mfaCode);
  const overrides = getDevOverrides();
  const central=await centralEntitlement(userId,true);if(central?.blocked && !overrides.bypassDeviceLimit)throw new DeviceLimitError(0);
  if(!central&&await hasCentralLink(prisma,userId))throw new Error('CENTRAL_REGISTRATION_REQUIRED');
  const deviceId = typeof body?.deviceId === 'string' && body.deviceId.trim().length >= 8 ? body.deviceId.trim().slice(0, 128) : crypto.randomUUID();
  const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : 'Nieznane urządzenie';
  const subscription = await prisma.subscription.findUnique({ where: { ownerKey: `user:${userId}` } });
  const plan = central ? central.plan : subscription?.plan === 'premium' && ['active', 'trialing'].includes(subscription.status) ? 'premium' : subscription?.plan === 'standard' && ['active', 'trialing'].includes(subscription.status) ? 'standard' : 'free';
  const limit = getCatalog().plans[plan].accountDevices ?? Number.POSITIVE_INFINITY;
  if (Number.isFinite(limit) && !overrides.bypassDeviceLimit) {
    const activeSessions = await prisma.authSession.findMany({ where: { userId, ...activeSessionWhere() }, select: { deviceId: true } });
    const deviceCount = new Set(activeSessions.map(session => session.deviceId).filter(Boolean)).size;
    const alreadyRegistered = activeSessions.some(session => session.deviceId === deviceId);
    if (!alreadyRegistered && deviceCount >= limit) throw new DeviceLimitError(limit);
  }
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const token = sessionToken(userId, expiresAt);
  await prisma.authSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt, deviceId, deviceName } });
  return { token, expiresAt, user: { id: userId, email, name } };
}
