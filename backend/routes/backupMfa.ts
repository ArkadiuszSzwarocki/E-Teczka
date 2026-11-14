import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { securityDir } from '../config/paths';
import { requireLocalDesktop } from '../middleware/accessControl';
import { billingOwnerKey } from '../middleware/premium';
import { createBackupMfaStore } from '../services/backupMfaStore';
import { verifyBackupPrimary } from '../services/backupPrimary';

const mfa = createBackupMfaStore(path.join(securityDir, 'backup-mfa.enc'));
const grants = new Map<string, { owner: string; expires: number; remaining: Set<string> }>();
const attempts = new Map<string, { count: number; expires: number }>();
const mfaOwner = (res: express.Response) => `documents:${Number(res.locals.userId || 1)}`;
const actions: Record<string, string[]> = { send: ['destination', 'cloud'], cloudRestore: ['cloud/latest', 'restore'], restore: ['restore'], export: ['export'], recoveryKey: ['recovery-key'], connect: ['oauth'] };

export function createBackupMfaRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/status', (_req, res) => { try { res.setHeader('Cache-Control', 'no-store'); res.json({ enabled: mfa.enabled(mfaOwner(res)) }); } catch { res.status(503).json({ error: 'Nie można odczytać zabezpieczeń kopii.' }); } });
  router.post('/start', requireLocalDesktop, async (req, res) => {
    const owner = mfaOwner(res); const primaryOwner = billingOwnerKey(res); const now = Date.now(); const previous = attempts.get(owner);
    if (previous && previous.expires > now && previous.count >= 5) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj za 5 minut.' });
    if (!await verifyBackupPrimary(prisma, primaryOwner, String(req.body?.password || ''))) { const entry = previous && previous.expires > now ? previous : { count: 0, expires: now + 300_000 }; entry.count++; attempts.set(owner, entry); return res.status(401).json({ error: 'Nieprawidłowy PIN lub hasło E-Teczki.' }); }
    attempts.delete(owner);
    try { const { uri } = mfa.start(owner); res.setHeader('Cache-Control', 'no-store'); res.json({ uri }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się rozpocząć konfiguracji.' }); }
  });
  router.post('/confirm', requireLocalDesktop, (req, res) => { try { const codes = mfa.confirm(mfaOwner(res), String(req.body?.code || '')); res.setHeader('Cache-Control', 'no-store'); res.json({ codes }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się włączyć Authenticatora.' }); } });
  router.post('/disable', requireLocalDesktop, async (req, res) => {
    const owner = mfaOwner(res); const now = Date.now(); const previous = attempts.get(owner);
    if (previous && previous.expires > now && previous.count >= 5) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj za 5 minut.' });
    if (!await verifyBackupPrimary(prisma, billingOwnerKey(res), String(req.body?.password || ''))) { const entry = previous && previous.expires > now ? previous : { count: 0, expires: now + 300_000 }; entry.count++; attempts.set(owner, entry); return res.status(401).json({ error: 'Nieprawidłowy PIN lub hasło E-Teczki.' }); }
    attempts.delete(owner);
    try {
      if (!mfa.verify(owner, String(req.body?.code || ''))) return res.status(401).json({ error: 'Nieprawidłowy lub użyty kod Authenticatora.' });
      mfa.remove(owner); for (const [token, grant] of grants) if (grant.owner === owner) grants.delete(token);
      res.setHeader('Cache-Control', 'no-store'); return res.json({ enabled: false });
    } catch { return res.status(503).json({ error: 'Nie można zmienić zabezpieczeń kopii.' }); }
  });
  router.post('/authorize', requireLocalDesktop, (req, res) => {
    const owner = mfaOwner(res); const action = String(req.body?.action || '');
    if (!actions[action]) return res.status(400).json({ error: 'Nieznana operacja.' });
    try {
      if (!mfa.enabled(owner)) return res.json({ required: false });
      if (!mfa.verify(owner, String(req.body?.code || ''))) return res.status(401).json({ error: 'Nieprawidłowy lub użyty kod. Po wielu błędach odczekaj 5 minut.' });
      const token = crypto.randomBytes(32).toString('base64url');
      for (const [key, value] of grants) if (value.expires <= Date.now()) grants.delete(key);
      grants.set(token, { owner, expires: Date.now() + 15 * 60_000, remaining: new Set(actions[action]) });
      res.setHeader('Cache-Control', 'no-store'); res.json({ required: true, token });
    } catch { res.status(503).json({ error: 'Nie można odczytać zabezpieczeń kopii.' }); }
  });
  return router;
}

export function requireBackupMfa(operation: string): express.RequestHandler {
  return (req, res, next) => {
    const owner = mfaOwner(res);
    try {
      if (!mfa.enabled(owner)) return next();
      const token = req.header('x-backup-authorization') || ''; const grant = grants.get(token);
      if (!grant || grant.owner !== owner || grant.expires <= Date.now() || !grant.remaining.has(operation)) return res.status(403).json({ code: 'BACKUP_MFA_REQUIRED', error: 'Potwierdź tę operację kodem Microsoft Authenticator.' });
      grant.remaining.delete(operation); if (!grant.remaining.size) grants.delete(token); return next();
    } catch { return res.status(503).json({ error: 'Nie można odczytać zabezpieczeń kopii.' }); }
  };
}
