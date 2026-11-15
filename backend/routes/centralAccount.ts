import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { centralAccountOrigin, createCentralAccountLinks, verifyCentralSession } from '../services/centralAccountLink';
import { createSession, DeviceLimitError, passwordHash } from './auth';
import { createCentralHandoffs } from '../services/centralHandoff';
import { verifyBackupPrimary } from '../services/backupPrimary';
import { copyDesktopPlanState, getPlan } from '../services/planLedger';

// Local-desktop access must be enforced by the caller before mounting this router.
export function createCentralAccountRouter(prisma: PrismaClient, verify = verifyCentralSession, handoffs = createCentralHandoffs(), verifyDesktop = verifyBackupPrimary) {
  const router = express.Router(); const links = createCentralAccountLinks(prisma);
  let desktopFailures = 0; let desktopBlockedUntil = 0;
  const origin = () => centralAccountOrigin(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
  const bearer = (req: express.Request) => req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  router.get('/status', (_req, res) => { const base = origin(); res.json({ configured: Boolean(base), origin: base }); });
  router.post('/handoff/start', async (_req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    try { return res.json(await handoffs.start(base)); } catch { return res.status(503).json({ error: 'Nie udało się rozpocząć logowania.' }); }
  });
  router.post('/handoff/poll', async (req, res) => {
    try { return res.json(await handoffs.poll(String(req.body?.handle || ''))); }
    catch { return res.status(400).json({ error: 'Logowanie wygasło lub nie udało się połączyć.' }); }
  });
  router.post('/handoff/finish', async (req, res) => {
    try {
      const handle = String(req.body?.handle || ''), approved = await handoffs.take(handle), localId = await links.find(approved.origin, approved.user.id);
      if (!localId) return res.status(409).json({ code: 'LOCAL_LINK_REQUIRED', user: approved.user, error: 'Połącz konto z istniejącymi danymi albo utwórz konto na tym komputerze.' });
      const user = await prisma.user.findUnique({ where: { id: localId }, select: { id: true, email: true, name: true } });
      if (!user) return res.status(409).json({ error: 'Nie znaleziono konta lokalnego.' });
      const session = await createSession(prisma, user.id, user.email, user.name, req.body); handoffs.finish(handle);
      return res.json(session);
    } catch (error) { if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message }); return res.status(401).json({ error: 'Nie udało się potwierdzić sesji.' }); }
  });
  router.post('/handoff/link', async (req, res) => {
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
    try {
      const handle = String(req.body?.handle || ''), approved = await handoffs.take(handle);
      if (await links.localUserId(bearer(req)) !== localId) return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
      const existing = await links.find(approved.origin, approved.user.id);
      if (existing !== null && existing !== localId) return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
      if (existing === null) await links.link(approved.origin, approved.user.id, localId);
      handoffs.finish(handle); return res.status(204).end();
    } catch { return res.status(409).json({ error: 'Nie udało się połączyć kont. Sprawdź istniejące powiązania.' }); }
  });
  router.post('/handoff/link-desktop', async (req, res) => {
    if (desktopBlockedUntil > Date.now()) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie za 5 minut.' });
    const secret = typeof req.body?.secret === 'string' ? req.body.secret : '';
    if (!await verifyDesktop(prisma, 'desktop-local', secret)) {
      desktopFailures++; if (desktopFailures >= 5) { desktopBlockedUntil = Date.now() + 300000; desktopFailures = 0; }
      return res.status(401).json({ error: 'Nieprawidłowy PIN lub hasło aplikacji.' });
    }
    desktopFailures = 0;
    try {
      const handle = String(req.body?.handle || ''), approved = await handoffs.take(handle);
      const user = await prisma.user.findUnique({ where: { id: 1 }, select: { id: true, email: true, name: true } });
      if (!user) return res.status(409).json({ error: 'Nie znaleziono konta lokalnego z danymi komputera.' });
      if (await getPlan(prisma, 'desktop-local') !== 'free') return res.status(409).json({ code: 'BILLING_MIGRATION_REQUIRED', error: 'Aktywny plan lokalny wymaga przeniesienia do konta centralnego. Dane i obecny plan pozostają dostępne.' });
      const existing = await links.find(approved.origin, approved.user.id);
      if (existing !== null && existing !== user.id) return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
      await copyDesktopPlanState(prisma, `user:${user.id}`);
      if (existing === null) await links.link(approved.origin, approved.user.id, user.id);
      const session = await createSession(prisma, user.id, user.email, user.name, req.body); handoffs.finish(handle); return res.json(session);
    } catch (error) { if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message }); return res.status(409).json({ error: 'Nie udało się połączyć danych z tym kontem.' }); }
  });
  router.post('/handoff/create-local', async (req, res) => {
    try {
      const localPassword = req.body?.localPassword;
      if (typeof localPassword !== 'string' || localPassword.length < 8 || localPassword.length > 200) return res.status(400).json({ error: 'Ustaw hasło lokalne zawierające co najmniej 8 znaków.' });
      const handle = String(req.body?.handle || ''), approved = await handoffs.take(handle);
      if (await links.find(approved.origin, approved.user.id) !== null) return res.status(409).json({ error: 'To konto jest już połączone. Zaloguj się ponownie.' });
      const email = approved.user.email.trim().toLowerCase();
      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return res.status(409).json({ code: 'LOCAL_ACCOUNT_EXISTS', error: 'Konto lokalne z tym adresem już istnieje. Zaloguj się na nie i połącz konta.' });
      const user = await prisma.$transaction(async tx => {
        const created = await tx.user.create({ data: { email, name: approved.user.name, passwordHash: passwordHash(localPassword) }, select: { id: true, email: true, name: true } });
        await tx.$executeRaw`INSERT INTO CentralAccountLink(centralOrigin, centralId, localUserId, createdAt) VALUES (${approved.origin}, ${approved.user.id}, ${created.id}, ${new Date().toISOString()})`;
        return created;
      });
      const session = await createSession(prisma, user.id, user.email, user.name, req.body); handoffs.finish(handle); return res.status(201).json(session);
    } catch (error) { if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message }); return res.status(409).json({ error: 'Nie udało się utworzyć konta lokalnego lub sesji.' }); }
  });
  router.post('/link', async (req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
    try {
      const remote = await verify(base, req.body?.centralToken);
      if (await links.localUserId(bearer(req)) !== localId) return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
      const existing = await links.find(base, remote.id);
      if (existing === localId) return res.status(204).end();
      if (existing !== null) return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
      await links.link(base, remote.id, localId);
      return res.status(204).end();
    } catch { return res.status(409).json({ error: 'Nie udało się połączyć kont. Sprawdź sesję i istniejące powiązania.' }); }
  });
  router.post('/login', async (req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    try {
      const remote = await verify(base, req.body?.centralToken); const localId = await links.find(base, remote.id);
      if (!localId) return res.status(409).json({ code: 'LOCAL_LINK_REQUIRED', error: 'Najpierw połącz konto centralne z kontem na tym komputerze.' });
      const user = await prisma.user.findUnique({ where: { id: localId }, select: { id: true, email: true, name: true } });
      if (!user) return res.status(409).json({ error: 'Nie znaleziono połączonego konta lokalnego.' });
      return res.json(await createSession(prisma, user.id, user.email, user.name, req.body));
    } catch (error) {
      if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
      return res.status(401).json({ error: 'Nie udało się potwierdzić sesji konta centralnego.' });
    }
  });
  router.post('/unlink', async (req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
    try {
      const remote = await verify(base, req.body?.centralToken);
      if (await links.localUserId(bearer(req)) !== localId) return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
      if (!await links.unlink(base, remote.id, localId)) return res.status(404).json({ error: 'Nie znaleziono powiązania kont.' });
      return res.status(204).end();
    } catch { return res.status(401).json({ error: 'Nie udało się potwierdzić sesji konta centralnego.' }); }
  });
  return router;
}
