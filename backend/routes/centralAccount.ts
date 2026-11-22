import { AccountMfaRequired } from '../services/accountMfa';
import { registerCentralDevice, revokeCentralDevice } from '../services/centralEntitlements';
import { bootstrapCentralPlan } from '../services/centralPlanLedger';
import { randomBytes } from 'node:crypto';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { centralAccountOrigin, createCentralAccountLinks, verifyCentralSession } from '../services/centralAccountLink';
import { createSession, DeviceLimitError, passwordHash } from './auth';
import { CentralHandoffError, createCentralHandoffs } from '../services/centralHandoff';
import { verifyBackupPrimary } from '../services/backupPrimary';
import { copyDesktopPlanState, getPlan } from '../services/planLedger';
import { verifyCentralPurchase } from '../services/centralEntitlements';
import { getDevOverrides } from '../services/devOverrides';

// Local-desktop access must be enforced by the caller before mounting this router.
export function createCentralAccountRouter(prisma: PrismaClient, verify = verifyCentralSession, handoffs = createCentralHandoffs(), verifyDesktop = verifyBackupPrimary, prepareDevice?: (userId:number,origin:string,accountId:string,token:string)=>Promise<void>) {
  const enrollDevice = prepareDevice || (async (userId: number, base: string, accountId: string, token: string) => {
    try {
      await registerCentralDevice(userId, base, accountId, token);
      await bootstrapCentralPlan(prisma, userId);
    } catch (err) {
      if (err instanceof Error && err.message === 'CENTRAL_DEVICE_LIMIT' && getDevOverrides().bypassDeviceLimit) {
        return;
      }
      throw err;
    }
  });
  const router = express.Router(); const links = createCentralAccountLinks(prisma);
  let desktopFailures = 0; let desktopBlockedUntil = 0;
  const origin = () => centralAccountOrigin(process.env.MOJATECZKA_CENTRAL_ACCOUNT_URL);
  const bearer = (req: express.Request) => req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  router.get('/status', async (_req, res) => {
    const base = origin(); let googleEnabled = false;
    if (base) { try { const response = await fetch(`${base}/public-config`, { redirect: 'error', signal: AbortSignal.timeout(3000) }); if (response.ok) { const config = await response.json() as { googleWebClientId?: unknown }; googleEnabled = typeof config.googleWebClientId === 'string' && Boolean(config.googleWebClientId.trim()); } } catch { /* Password login remains available without Google. */ } }
    res.json({ configured: Boolean(base), origin: base, googleEnabled });
  });
  router.post('/request-password-reset', async (req, res) => {
    const base = origin();
    if (!base) return res.status(503).json({ error: 'Usługa kont nie jest skonfigurowana.' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Podaj poprawny adres e-mail.' });
    try {
      const upstream = await fetch(`${base}/request-password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (upstream.status === 429) {
        const retry = Number(upstream.headers.get('retry-after'));
        const waitText = Number.isFinite(retry) && retry > 0 ? `za ${Math.ceil(retry / 60)} min` : 'za kilka minut';
        return res.status(429).json({ error: `Zbyt wiele prób wysłania linku. Spróbuj ponownie ${waitText}.` });
      }
      if (!upstream.ok) return res.status(503).json({ error: 'Usługa jest chwilowo niedostępna. Spróbuj ponownie.' });
      return res.status(202).json({ message: 'Jeśli ten adres należy do potwierdzonego konta, wyślemy jednorazowy link do ustawienia lub zmiany hasła E‑Teczki. Sprawdź również folder spam. Logowanie Google pozostanie dostępne.' });
    } catch { return res.status(503).json({ error: 'Nie można połączyć się z usługą kont. Spróbuj ponownie.' }); }
  });
  router.post('/register', async (req, res) => {
    const base = origin();
    if (!base) return res.status(503).json({ error: 'Usługa kont nie jest skonfigurowana.' });
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Podaj e-mail i hasło od 8 do 200 znaków.' });
    try {
      const upstream = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      const payload = await upstream.json();
      return res.status(upstream.status).json(payload);
    } catch { return res.status(503).json({ error: 'Nie można połączyć się z usługą kont. Spróbuj ponownie.' }); }
  });
  router.post('/credentials', async (req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 200) return res.status(400).json({ error: 'Podaj e-mail i hasło.' });
    let token: string | undefined;
    try {
      const login = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!login.ok) return res.status(login.status === 429 ? 429 : login.status === 503 ? 503 : 401).json({ error: 'Nie udało się zalogować. Sprawdź dane, potwierdzenie e-maila lub spróbuj później.' });
      const session = await login.json() as { token?: string }; token = session.token;
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('INVALID_SESSION');
      const start = await handoffs.start(base);
      const requestId = new URL(start.url).hash.slice(1);
      const approval = await fetch(`${base}/handoff/approve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ requestId }), redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!approval.ok) throw new Error('APPROVAL_FAILED');
      const approved = await handoffs.poll(start.handle);
      if (approved.status !== 'approved') throw new Error('APPROVAL_FAILED');
      return res.json({ ...start, user: approved.user });
    } catch { return res.status(503).json({ error: 'Nie udało się połączyć z usługą kont. Spróbuj ponownie.' }); }
    finally { if (token) await fetch(`${base}/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => undefined); }
  });
  router.post('/handoff/start', async (_req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    try { return res.json(await handoffs.start(base)); } catch(error) {
      if(error instanceof CentralHandoffError&&error.code==='CENTRAL_RATE_LIMIT'){res.setHeader('Retry-After',String(error.retryAfter||60));return res.status(429).json({code:error.code,retryAfter:error.retryAfter,error:`Serwer kont ograniczył liczbę prób. Spróbuj ponownie za ${error.retryAfter||60} s.`});}
      const code=error instanceof CentralHandoffError?error.code:'CENTRAL_HANDOFF_FAILED';console.warn('[login/start]',code);
      return res.status(503).json({code,error:code==='CENTRAL_CONNECTION_FAILED'?'Nie można połączyć się z konto.arecki.pl. Sprawdź internet i spróbuj ponownie.':code==='CENTRAL_TIMEOUT'?'Serwer kont nie odpowiedział na czas. Spróbuj ponownie.':'Usługa logowania jest chwilowo niedostępna. Spróbuj ponownie za chwilę.'});
    }
  });
  router.post('/handoff/poll', async (req, res) => {
    try { return res.json(await handoffs.poll(String(req.body?.handle || ''))); }
    catch { return res.status(400).json({ error: 'Logowanie wygasło lub nie udało się połączyć.' }); }
  });
  const fetchCentralDevices = async (originUrl: string, centralToken: string) => {
    const upstream = await fetch(`${originUrl}/devices`, {
      headers: { authorization: `Bearer ${centralToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
    });
    if (!upstream.ok) throw new Error('CENTRAL_DEVICES_UNAVAILABLE');
    const data = await upstream.json() as {
      plan?: string;
      deviceLimits?: { desktop?: number | null; mobile?: number | null };
      devices?: Array<{ device_id?: string; kind?: string; name?: string; created_at?: number; last_seen?: number }>;
    };
    return {
      plan: data.plan || 'free',
      deviceLimits: data.deviceLimits || { desktop: 1, mobile: 1 },
      devices: Array.isArray(data.devices) ? data.devices.map(d => ({
        deviceId: String(d.device_id || ''),
        kind: d.kind === 'mobile' ? 'mobile' : 'desktop',
        name: String(d.name || (d.kind === 'mobile' ? 'Urządzenie mobilne' : 'Komputer')),
        createdAt: Number(d.created_at || 0),
        lastSeen: Number(d.last_seen || 0),
      })) : [],
    };
  };
  router.post('/handoff/devices', async (req, res) => {
    try {
      const approved = await handoffs.take(String(req.body?.handle || ''));
      return res.json(await fetchCentralDevices(approved.origin, approved.centralToken));
    } catch {
      return res.status(400).json({ error: 'Nie udało się pobrać listy zaufanych urządzeń. Zaloguj się ponownie.' });
    }
  });
  router.post('/handoff/devices/revoke', async (req, res) => {
    const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId.trim() : '';
    if (!deviceId) return res.status(400).json({ error: 'Brak identyfikatora urządzenia.' });
    try {
      const approved = await handoffs.take(String(req.body?.handle || ''));
      const upstream = await fetch(`${approved.origin}/devices/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${approved.centralToken}` },
        body: JSON.stringify({ deviceId }),
        redirect: 'error',
        signal: AbortSignal.timeout(7000),
      });
      if (!upstream.ok) return res.status(502).json({ error: 'Nie udało się usunąć zaufania urządzenia.' });
      return res.json(await fetchCentralDevices(approved.origin, approved.centralToken));
    } catch {
      return res.status(400).json({ error: 'Sesja logowania wygasła. Rozpocznij logowanie ponownie.' });
    }
  });
  router.post('/handoff/finish', async (req, res) => {
    try {
      const handle = String(req.body?.handle || '');
      const approved = await handoffs.take(handle);
      let localId = await links.find(approved.origin, approved.user.id);
      if (!localId && req.body?.createNew === true) {
        const email = approved.user.email.trim().toLowerCase();
        if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return res.status(409).json({ code: 'LOCAL_ACCOUNT_EXISTS', error: 'Na komputerze istnieje osobne konto z tym adresem. Połącz je po potwierdzeniu dotychczasowego dostępu.' });
        const created = await prisma.$transaction(async tx => {
          const user = await tx.user.create({ data: { email, name: approved.user.name, passwordHash: passwordHash(randomBytes(32).toString('hex')) }, select: { id: true } });
          await tx.$executeRaw`INSERT INTO CentralAccountLink(centralOrigin, centralId, localUserId, createdAt) VALUES (${approved.origin}, ${approved.user.id}, ${user.id}, ${new Date().toISOString()})`;
          return user;
        });
        localId = created.id;
      }
      if (!localId) return res.status(409).json({ code: 'LOCAL_LINK_REQUIRED', user: approved.user, error: 'Połącz konto z istniejącymi danymi albo utwórz konto na tym komputerze.' });
      const user = await prisma.user.findUnique({ where: { id: localId }, select: { id: true, email: true, name: true } });
      if (!user) return res.status(409).json({ error: 'Nie znaleziono konta lokalnego.' });
      try {
        await enrollDevice(user.id, approved.origin, approved.user.id, approved.centralToken);
      } catch (enrollError) {
        if (enrollError instanceof Error && enrollError.message === 'CENTRAL_DEVICE_LIMIT') {
          const deviceData = await fetchCentralDevices(approved.origin, approved.centralToken).catch(() => null);
          return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: 'Osiągnięto limit urządzeń konta. Usuń nieużywane urządzenie poniżej lub zmień plan.', ...(deviceData || {}) });
        }
        throw enrollError;
      }
      const session = await createSession(prisma, user.id, user.email, user.name, req.body); handoffs.finish(handle);
      return res.json(session);
    } catch (error) { if(error instanceof Error&&error.message==='CENTRAL_DEVICE_LIMIT')return res.status(403).json({code:'DEVICE_LIMIT_REACHED',error:'Osiągnięto limit urządzeń konta. Usuń nieużywane urządzenie poniżej lub zmień plan.'}); if(error instanceof Error&&error.message==='CENTRAL_ENTITLEMENTS_UNAVAILABLE')return res.status(503).json({error:'Serwer kont wymaga aktualizacji lub jest niedostępny. Nie udało się pobrać planu konta.'}); if (error instanceof AccountMfaRequired) return res.status(401).json({code:error.code,error:error.message}); if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message }); return res.status(401).json({ error: 'Nie udało się potwierdzić sesji.' }); }
  });
  router.post('/handoff/link', async (req, res) => {
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
    try {
      const handle = String(req.body?.handle || ''), approved = await handoffs.take(handle);
      if (await links.localUserId(bearer(req)) !== localId) return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
      const existing = await links.find(approved.origin, approved.user.id);
      if (existing !== null && existing !== localId) return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
      if (existing === null) await links.link(approved.origin, approved.user.id, localId); await enrollDevice(localId,approved.origin,approved.user.id,approved.centralToken);
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
      await enrollDevice(user.id,approved.origin,approved.user.id,approved.centralToken); const session = await createSession(prisma, user.id, user.email, user.name, req.body); handoffs.finish(handle); return res.json(session);
    } catch (error) { if(error instanceof Error&&error.message==='CENTRAL_DEVICE_LIMIT')return res.status(403).json({code:'DEVICE_LIMIT_REACHED',error:'Osiągnięto limit urządzeń konta. Usuń nieużywane urządzenie na konto.arecki.pl/account (sekcja „Plan i zaufane urządzenia”) lub zmień plan.'}); if(error instanceof Error&&error.message==='CENTRAL_ENTITLEMENTS_UNAVAILABLE')return res.status(503).json({error:'Serwer kont wymaga aktualizacji lub jest niedostępny. Nie udało się pobrać planu konta.'}); if (error instanceof AccountMfaRequired) return res.status(401).json({code:error.code,error:error.message}); if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message }); return res.status(409).json({ error: 'Nie udało się połączyć danych z tym kontem.' }); }
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
      await enrollDevice(user.id,approved.origin,approved.user.id,approved.centralToken); const session = await createSession(prisma, user.id, user.email, user.name, req.body); handoffs.finish(handle); return res.status(201).json(session);
    } catch (error) { if(error instanceof Error&&error.message==='CENTRAL_DEVICE_LIMIT')return res.status(403).json({code:'DEVICE_LIMIT_REACHED',error:'Osiągnięto limit urządzeń konta. Usuń nieużywane urządzenie na konto.arecki.pl/account (sekcja „Plan i zaufane urządzenia”) lub zmień plan.'}); if(error instanceof Error&&error.message==='CENTRAL_ENTITLEMENTS_UNAVAILABLE')return res.status(503).json({error:'Serwer kont wymaga aktualizacji lub jest niedostępny. Nie udało się pobrać planu konta.'}); if (error instanceof AccountMfaRequired) return res.status(401).json({code:error.code,error:error.message}); if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message }); return res.status(409).json({ error: 'Nie udało się utworzyć konta lokalnego lub sesji.' }); }
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
      await enrollDevice(localId,base,remote.id,req.body.centralToken); await links.link(base, remote.id, localId);
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
      await enrollDevice(user.id,base,remote.id,req.body.centralToken); return res.json(await createSession(prisma, user.id, user.email, user.name, req.body));
    } catch (error) {
      if (error instanceof AccountMfaRequired) return res.status(401).json({code:error.code,error:error.message}); if (error instanceof DeviceLimitError) return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
      return res.status(401).json({ error: 'Nie udało się potwierdzić sesji konta centralnego.' });
    }
  });
  router.post('/unlink', async (req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
    try {
      const remote = await verify(base, req.body?.centralToken);
      if (await links.localUserId(bearer(req)) !== localId) return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
      await revokeCentralDevice(localId,req.body.centralToken); if (!await links.unlink(base, remote.id, localId)) return res.status(404).json({ error: 'Nie znaleziono powiązania kont.' });
      return res.status(204).end();
    } catch { return res.status(401).json({ error: 'Nie udało się potwierdzić sesji konta centralnego.' }); }
  });
  router.post('/sync-session', async (req, res) => {
    const base = origin(); if (!base) return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
    const centralToken = typeof req.body?.centralToken === 'string' ? req.body.centralToken : '';
    try {
      const remote = await verify(base, centralToken);
      const linkedLocalId = await links.find(base, remote.id);
      if (linkedLocalId !== localId) {
        await links.revokeLocalSessions(localId);
        return res.status(401).json({ revoked: true, error: 'Sesja została unieważniona.' });
      }
      return res.json({ valid: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_SESSION') {
        await links.revokeLocalSessions(localId);
        return res.status(401).json({ revoked: true, error: 'Sesja centralna wygasła lub została unieważniona.' });
      }
      return res.status(503).json({ offline: true, error: 'Brak połączenia z usługą kont; zachowano dostęp offline.' });
    }
  });
  router.post('/google-play/verify', async (req, res) => {
    const localId = await links.localUserId(bearer(req)); if (!localId) return res.status(401).json({ error: 'Najpierw zaloguj się na konto.' });
    const packageName = typeof req.body?.packageName === 'string' ? req.body.packageName.trim() : '';
    const subscriptionId = typeof req.body?.subscriptionId === 'string' ? req.body.subscriptionId.trim() : '';
    const purchaseToken = typeof req.body?.purchaseToken === 'string' ? req.body.purchaseToken.trim() : '';
    if (!packageName || !subscriptionId || !purchaseToken) return res.status(400).json({ error: 'Brak wymaganych danych zakupu Google Play.' });
    try {
      return res.json(await verifyCentralPurchase(localId,{packageName,subscriptionId,purchaseToken}));
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (['BILLING_NOT_CONFIGURED','CENTRAL_ACCOUNT_REQUIRED'].includes(msg)) return res.status(503).json({ error: 'Weryfikacja Google Play nie jest jeszcze skonfigurowana na serwerze.' });
      return res.status(400).json({ error: 'Nie udało się potwierdzić subskrypcji Google Play.' });
    }
  });
  return router;
}
