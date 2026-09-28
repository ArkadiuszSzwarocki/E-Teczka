import crypto from 'crypto';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { authSecret } from '../security/authSecret';

const AUTH_SECRET = authSecret();
const SESSION_DAYS = 30;
const DEVICE_LIMITS: Record<string, number> = { free: 1, standard: 2, premium: Number.POSITIVE_INFINITY };

function passwordHash(password: string, salt = crypto.randomBytes(16).toString('hex')) {
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
  const payload = `${userId}.${expiresAt.getTime()}`;
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

  router.post('/register', async (request, response) => {
    if (!validCredentials(request.body)) return response.status(400).json({ error: 'Podaj poprawny e‑mail i hasło (minimum 8 znaków).' });
    const email = request.body.email.trim().toLowerCase();
    try {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return response.status(409).json({ error: 'Konto z tym adresem już istnieje.' });
      const user = await prisma.user.create({ data: { email, name: email.split('@')[0], passwordHash: passwordHash(request.body.password) } });
      return response.status(201).json(await createSession(prisma, user.id, user.email, user.name, request.body));
    } catch { return response.status(500).json({ error: 'Nie udało się utworzyć konta.' }); }
  });

  router.post('/login', async (request, response) => {
    if (!validCredentials(request.body)) return response.status(400).json({ error: 'Podaj e‑mail i hasło.' });
    const email = request.body.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !passwordMatches(request.body.password, user.passwordHash)) return response.status(401).json({ error: 'Nieprawidłowy e‑mail lub hasło.' });
    try {
      return response.json(await createSession(prisma, user.id, user.email, user.name, request.body));
    } catch (error) {
      if (error instanceof DeviceLimitError) return response.status(403).json({ error: error.message, code: 'DEVICE_LIMIT_REACHED', limit: error.limit });
      return response.status(500).json({ error: 'Nie udało się utworzyć sesji.' });
    }
  });

  router.post('/logout', async (request, response) => {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (token) await prisma.authSession.deleteMany({ where: { tokenHash: crypto.createHash('sha256').update(token).digest('hex') } });
    response.json({ success: true });
  });

  router.get('/me', async (request, response) => {
    const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return response.status(401).json({ error: 'Brak aktywnej sesji.' });
    const session = await prisma.authSession.findFirst({ where: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: { gt: new Date() } }, include: { user: true } });
    const user = session?.user;
    if (!user) return response.status(401).json({ error: 'Sesja wygasła.' });
    response.json({ id: user.id, email: user.email, name: user.name });
  });

  return router;
}

class DeviceLimitError extends Error { constructor(public readonly limit: number) { super(`Limit urządzeń dla tego planu został osiągnięty (${limit}). Wyloguj inne urządzenie albo wybierz wyższy plan.`); } }

async function createSession(prisma: PrismaClient, userId: number, email: string, name: string | null, body?: Record<string, unknown>) {
  const deviceId = typeof body?.deviceId === 'string' && body.deviceId.trim().length >= 8 ? body.deviceId.trim().slice(0, 128) : crypto.randomUUID();
  const deviceName = typeof body?.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : 'Nieznane urządzenie';
  const subscription = await prisma.subscription.findUnique({ where: { ownerKey: `user:${userId}` } });
  const plan = subscription?.plan === 'premium' && ['active', 'trialing'].includes(subscription.status) ? 'premium' : subscription?.plan === 'standard' && ['active', 'trialing'].includes(subscription.status) ? 'standard' : 'free';
  const limit = DEVICE_LIMITS[plan];
  if (Number.isFinite(limit)) {
    const activeSessions = await prisma.authSession.findMany({ where: { userId, expiresAt: { gt: new Date() } }, select: { deviceId: true } });
    const deviceCount = new Set(activeSessions.map(session => session.deviceId).filter(Boolean)).size;
    const alreadyRegistered = activeSessions.some(session => session.deviceId === deviceId);
    if (!alreadyRegistered && deviceCount >= limit) throw new DeviceLimitError(limit);
  }
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const token = sessionToken(userId, expiresAt);
  await prisma.authSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId, expiresAt, deviceId, deviceName } });
  return { token, expiresAt, user: { id: userId, email, name } };
}
