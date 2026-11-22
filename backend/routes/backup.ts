import express from 'express';
import crypto from 'node:crypto';
import * as archiver from 'archiver';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { billingOwnerKey } from '../middleware/premium';
import { featureTrial, getPlan } from '../services/planLedger';
import { ocrOwnerKey } from '../services/ocrPremium';
import { encrypt, decrypt, exportRecoveryKey, importRecoveryKey } from '../services/backupCrypto';
import { requireLocalDesktop } from '../middleware/accessControl';
import { restoreBackup } from '../services/restoreBackup';
import { exportSystemSettings, restoreSystemSettings } from '../services/settingsBackup';
import { importExternalArchive } from '../services/externalImport';
import { listWebDavFolders, createWebDavFolder, normalizeWebDavEndpoint } from '../services/webdavFolders';
import { suggestNasHostname } from '../services/webdavCertificate';
import { createBackupMfaRouter, requireBackupMfa } from './backupMfa';
import {
  buildBackupArchive,
  buildEncryptedBackupBuffer,
  downloadCloudBackup,
  listCloudBackups,
  oauthCallbackUrl,
  oauthConfig,
  refreshOAuthCredentials,
  uploadEncryptedBackupToCloud,
} from '../services/cloudBackupTransfer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
const allowedProviders = new Set(['webdav', 'google-drive', 'onedrive', 'dropbox']);
const PREMIUM_PLANS = new Set(['premium', 'family', 'business']);
const oauthStates = new Map<string, { ownerKey: string; provider: string; expiresAt: number }>();

async function isPremium(prisma: PrismaClient, res: express.Response) {
  const req = res.req;
  const start = req.method !== 'GET' || req.path.startsWith('/oauth/');
  return (await featureTrial(prisma, ocrOwnerKey(res), 'cloudBackup', start)).allowed;
}

/** Executes a scheduled backup for an owner. ownerId is the document owner id. */
export async function runScheduledCloudBackup(prisma: PrismaClient, ownerKey: string, ownerIdValue: number) {
  const destination = await prisma.backupDestination.findUnique({ where: { ownerKey } });
  if (!destination?.enabled || !destination.schedule || destination.schedule === 'manual') return false;
  const credentials: { username?: string; password?: string; accessToken?: string; purpose?: string } = destination.provider === 'webdav'
    ? (destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) : {})
    : await refreshOAuthCredentials(prisma, destination);
  if (destination.provider === 'webdav' && (credentials.purpose !== 'backup-only' || !credentials.username || !credentials.password)) {
    throw new Error('Skonfiguruj osobne konto NAS przeznaczone do automatycznej kopii.');
  }
  const data = await buildEncryptedBackupBuffer(prisma, ownerIdValue, ownerKey);
  const response = await uploadEncryptedBackupToCloud(destination, credentials, data);
  if (!response.ok) throw new Error(`Cloud upload failed (${response.status}).`);
  return true;
}

export function createBackupRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.use('/authenticator', createBackupMfaRouter(prisma));

  router.post('/recovery-key', requireLocalDesktop, requireBackupMfa('recovery-key'), (req, res) => {
    try {
      const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : '';
      if (passphrase.length > 1024) return res.status(400).json({ error: 'Hasło jest zbyt długie.' });
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/json').send(exportRecoveryKey(passphrase));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się utworzyć klucza.' }); }
  });

  router.post('/webdav/folders', async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
    const connection = { endpoint: String(req.body?.endpoint || ''), username: String(req.body?.username || ''), password: String(req.body?.password || '') };
    const folder = String(req.body?.folder || '');
    try {
      if (!connection.username || !connection.password) return res.status(400).json({ error: 'Podaj użytkownika i hasło NAS, aby przeglądać foldery.' });
      if (req.body?.createName !== undefined) await createWebDavFolder(connection, folder, String(req.body.createName));
      res.json({ folders: await listWebDavFolders(connection, folder) });
    } catch (error) {
      const cause = error instanceof Error ? (error as Error & { cause?: { code?: string } }).cause : undefined;
      if (cause?.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        const suggestedEndpoint = await suggestNasHostname(normalizeWebDavEndpoint(connection.endpoint));
        return res.status(502).json({ error: suggestedEndpoint ? 'Certyfikat NAS-a nie obejmuje adresu IP. Znaleziono zweryfikowaną nazwę tego serwera.' : 'Certyfikat NAS-a nie obejmuje tego adresu IP. Użyj nazwy serwera zgodnej z certyfikatem.', suggestedEndpoint });
      }
      res.status(502).json({ error: error instanceof Error && !/fetch|network|certificate|redirect/i.test(error.message) ? error.message : 'Nie udało się połączyć z WebDAV. Sprawdź adres HTTPS, certyfikat i dostępność serwera.' });
    }
  });

  router.get('/oauth/:provider/start', requireBackupMfa('oauth'), async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
    const provider = String(req.params.provider);
    const config = oauthConfig[provider];
    if (!config || !config.clientId || !config.clientSecret) return res.status(503).json({ error: `Brak konfiguracji OAuth dla ${provider}.` });
    const state = crypto.randomBytes(24).toString('base64url');
    oauthStates.set(state, { ownerKey: billingOwnerKey(res), provider, expiresAt: Date.now() + 10 * 60_000 });
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthCallbackUrl(), response_type: 'code', state, scope: config.scope });
    if (provider === 'google-drive') params.set('access_type', 'offline');
    if (provider === 'dropbox') params.set('token_access_type', 'offline');
    const url = `${config.authorize}?${params.toString()}`;
    if (req.query.mode === 'json') return res.json({ url });
    res.redirect(url);
  });

  router.get('/destination', async (_req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    let backupUsername = '';
    let backupCredentialSaved = false;
    if (destination?.provider === 'webdav' && destination.encryptedCredentials) {
      try {
        const credentials = JSON.parse(decrypt(destination.encryptedCredentials)) as { username?: string; password?: string; purpose?: string };
        if (credentials.purpose === 'backup-only') { backupUsername = credentials.username || ''; backupCredentialSaved = Boolean(credentials.password); }
      } catch { return res.status(500).json({ error: 'Nie udało się odczytać ustawień konta kopii.' }); }
    }
    res.json(destination ? { provider: destination.provider, endpoint: destination.endpoint, backupUsername, backupCredentialSaved, remoteFolder: destination.remoteFolder, schedule: destination.schedule, lastBackupAt: destination.lastBackupAt, lastBackupStatus: destination.lastBackupStatus, lastBackupError: destination.lastBackupError, enabled: destination.enabled, configured: true } : { configured: false });
  });

  router.get('/runs', async (_req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Historia kopii wymaga planu Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) }, select: { id: true } });
    if (!destination) return res.json([]);
    res.json(await prisma.backupRun.findMany({ where: { destinationId: destination.id }, orderBy: { startedAt: 'desc' }, take: 50 }));
  });

  router.put('/destination', requireBackupMfa('destination'), async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
    const provider = String(req.body?.provider || '');
    let endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim().slice(0, 2000) : '';
    const remoteFolder = typeof req.body?.remoteFolder === 'string' ? req.body.remoteFolder.trim().slice(0, 500) : '';
    const schedule = String(req.body?.schedule || 'manual');
    if (!/^(manual|on_login|on_logout|(?:daily|weekly)(?:@(?:[01]\d|2[0-3]):[0-5]\d)?)$/.test(schedule)) return res.status(400).json({ error: 'Nieprawidłowy harmonogram kopii.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const nasPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    const backupUsername = typeof req.body?.backupUsername === 'string' ? req.body.backupUsername.trim() : '';
    const backupPassword = typeof req.body?.backupPassword === 'string' ? req.body.backupPassword : '';
    if (!allowedProviders.has(provider)) return res.status(400).json({ error: 'Nieobsługiwany dostawca chmury.' });
    if (provider === 'webdav') {
      try { endpoint = normalizeWebDavEndpoint(endpoint); }
      catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Nieprawidłowy adres serwera NAS.' }); }
    }
    const existing = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    let credentials: string | null = null;
    if (provider === 'webdav') {
      if (!username) return res.status(400).json({ error: 'Podaj nazwę swojego konta NAS.' });
      if (schedule !== 'manual') {
        const effectiveUser = backupUsername || username;
        const effectivePass = backupPassword || nasPassword;
        if (effectivePass) {
          const purpose = backupUsername && backupUsername.toLowerCase() !== username.toLowerCase() ? 'backup-only' : 'nas-auto';
          credentials = encrypt(JSON.stringify({ username: effectiveUser, password: effectivePass, purpose }));
        } else {
          if (!existing || existing.provider !== 'webdav' || !existing.encryptedCredentials || !existing.endpoint || normalizeWebDavEndpoint(existing.endpoint) !== endpoint) return res.status(400).json({ error: 'Podaj hasło NAS, aby zapisać automatyczną kopię.' });
          const saved = JSON.parse(decrypt(existing.encryptedCredentials)) as { username?: string; password?: string };
          if (saved.username !== effectiveUser || !saved.password) return res.status(400).json({ error: 'Podaj hasło NAS, aby zapisać automatyczną kopię.' });
          credentials = existing.encryptedCredentials;
        }
      }
    } else if (existing?.provider === provider) credentials = existing.encryptedCredentials;
    const destination = await prisma.backupDestination.upsert({ where: { ownerKey: billingOwnerKey(res) }, create: { ownerKey: billingOwnerKey(res), provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials }, update: { provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials, enabled: true } });
    res.json({ provider: destination.provider, endpoint: destination.endpoint, remoteFolder: destination.remoteFolder, schedule: destination.schedule, enabled: destination.enabled, configured: true });
  });

  router.post('/cloud', requireBackupMfa('cloud'), async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    if (!destination?.enabled) return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
    const isAuto = req.body?.auto === true;
    if (destination.provider === 'webdav' && !isAuto && (!req.body?.username || !req.body?.password)) return res.status(400).json({ error: 'Podaj swoje dane logowania NAS do ręcznej kopii.' });
    if (destination.provider === 'webdav' && isAuto && !destination.encryptedCredentials) return res.status(400).json({ error: 'Brak zapisanego konta NAS do automatycznej kopii.' });
    try {
      const credentials = destination.provider === 'webdav'
        ? (isAuto && destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) : { username: String(req.body.username), password: String(req.body.password) })
        : await refreshOAuthCredentials(prisma, destination);
      const data = await buildEncryptedBackupBuffer(prisma, ownerId(res), ocrOwnerKey(res));
      const response = await uploadEncryptedBackupToCloud(destination, credentials, data);
      if (!response.ok) return res.status(502).json({ error: response.status === 507 ? 'NAS zgłosił brak dostępnego miejsca (HTTP 507). Sprawdź wolne miejsce, limit konta oraz czy wybrano właściwy folder z prawem zapisu.' : `Serwer ${destination.provider === 'webdav' ? 'NAS/WebDAV' : destination.provider} odrzucił kopię (HTTP ${response.status}). Sprawdź folder i uprawnienia do zapisu.` });
      res.json({ success: true, provider: destination.provider, uploadedAt: new Date().toISOString() });
    } catch (error) { console.error('[backup] cloud upload:', error); res.status(502).json({ error: error instanceof Error && error.message.startsWith('Brak pliku dokumentu') ? error.message : 'Nie udało się utworzyć lub wysłać kopii. Sprawdź log serwera.' }); }
  });

  router.post('/cloud/list', requireBackupMfa('cloud/latest'), async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    if (!destination?.enabled) return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
    if (destination.provider === 'webdav' && (!req.body?.username || !req.body?.password)) return res.status(400).json({ error: 'Podaj swoje dane logowania NAS, aby wyświetlić kopie.' });
    try {
      const credentials = destination.provider === 'webdav' ? { username: String(req.body.username), password: String(req.body.password) } : await refreshOAuthCredentials(prisma, destination);
      const result = await listCloudBackups(destination, credentials);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.json({ backups: result.backups });
    } catch (error) { console.error('[backup] cloud list:', error); res.status(502).json({ error: 'Nie udało się pobrać listy kopii.' }); }
  });

  router.post('/cloud/latest', requireBackupMfa('cloud/latest'), async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    if (!destination?.enabled) return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
    if (destination.provider === 'webdav' && (!req.body?.username || !req.body?.password)) return res.status(400).json({ error: 'Podaj swoje dane logowania NAS, aby pobrać kopię.' });
    try {
      const requested = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
      if (requested && (!requested.toLowerCase().endsWith('.zip.enc') || requested.includes('/') || requested.includes('\\') || requested === '..')) {
        return res.status(400).json({ error: 'Nieprawidłowa nazwa kopii.' });
      }
      const credentials = destination.provider === 'webdav' ? { username: String(req.body.username), password: String(req.body.password) } : await refreshOAuthCredentials(prisma, destination);
      const result = await downloadCloudBackup(destination, credentials, requested);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="eteczka-cloud-backup.zip.enc"');
      res.send(result.buffer);
    } catch (error) { console.error('[backup] cloud download:', error); res.status(502).json({ error: 'Nie udało się pobrać kopii z chmury.' }); }
  });

  router.get('/export', requireBackupMfa('export'), async (_req, res) => {
    try {
      const { manifest, files } = await buildBackupArchive(prisma, ownerId(res), ocrOwnerKey(res));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
      const archive = new (archiver as any).ZipArchive({ zlib: { level: 6 } });
      archive.on('error', (error: Error) => { if (!res.headersSent) res.status(500); res.end(); console.error('[backup] export:', error); });
      archive.pipe(res);
      archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
      for (const file of files) archive.file(file.source, { name: file.archiveName });
      await archive.finalize();
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : 'Brak pliku dokumentu.' });
    }
  });

  router.post('/restore', requireBackupMfa('restore'), upload.single('backup'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Wybierz plik kopii zapasowej.' });
    if (req.body?.restoreMode !== 'replace') return res.status(400).json({ error: 'Przywracanie zastępuje aktualne dane. Potwierdź tę operację w aktualnej wersji aplikacji.' });
    try {
      let recoveryKey: Buffer | undefined;
      if (req.body?.recoveryKey) {
        const address = req.socket.remoteAddress || '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return res.status(403).json({ error: 'Klucz odzyskiwania można użyć tylko na komputerze.' });
        recoveryKey = importRecoveryKey(String(req.body.recoveryKey), String(req.body.recoveryPassphrase || ''));
      }
      const result = await restoreBackup(prisma, req.file.buffer, ownerId(res), res.locals.userId ? ownerId(res) : null, undefined, recoveryKey, ocrOwnerKey(res));
      res.json({ success: true, ...result });
    } catch (error) { console.error('[backup] restore:', error); res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się przywrócić kopii zapasowej.' }); }
  });

  router.get('/settings/export', async (_req, res) => {
    try {
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      if (!PREMIUM_PLANS.has(plan)) {
        return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Kopia zapasowa ustawień systemowych jest dostępna od pakietu Premium.' });
      }
      const data = await exportSystemSettings(prisma, ownerId(res), ocrOwnerKey(res));
      res.setHeader('Cache-Control', 'no-store');
      return res.json(data);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się wyeksportować ustawień.' });
    }
  });

  router.post('/settings/restore', async (req, res) => {
    try {
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      if (!PREMIUM_PLANS.has(plan)) {
        return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Kopia zapasowa ustawień systemowych jest dostępna od pakietu Premium.' });
      }
      const summary = await restoreSystemSettings(prisma, ownerId(res), ocrOwnerKey(res), req.body);
      return res.json({ success: true, ...summary });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się przywrócić ustawień.' });
    }
  });

  router.post('/import-external', upload.single('archive'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Wybierz plik archiwum ZIP do zaimportowania.' });
    try {
      const result = await importExternalArchive(prisma, req.file.buffer, ownerId(res), res.locals.userId ? ownerId(res) : null, undefined, ocrOwnerKey(res));
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[backup] import-external:', error);
      res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zaimportować archiwum.' });
    }
  });

  return router;
}

/** Public OAuth callback. Ownership is recovered from the short-lived state token. */
export function createBackupOAuthCallbackRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/callback', async (req, res) => {
    const state = String(req.query.state || '');
    const context = oauthStates.get(state);
    oauthStates.delete(state);
    if (!context || context.expiresAt < Date.now()) return res.status(400).send('Sesja OAuth wygasła. Wróć do E‑Teczki i spróbuj ponownie.');
    const config = oauthConfig[context.provider];
    const code = String(req.query.code || '');
    if (!config || !code) return res.status(400).send('Brak kodu autoryzacji OAuth.');
    try {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oauthCallbackUrl(), client_id: config.clientId!, client_secret: config.clientSecret! });
      const tokenResponse = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenResponse.ok || !tokens.access_token) return res.status(502).send('Dostawca chmury odrzucił autoryzację.');
      await prisma.backupDestination.upsert({ where: { ownerKey: context.ownerKey }, create: { ownerKey: context.ownerKey, provider: context.provider, encryptedCredentials: encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true }, update: { provider: context.provider, encryptedCredentials: encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true } });
      res.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka</title><h2>Chmura została połączona.</h2><p>Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p>');
    } catch { res.status(502).send('Nie udało się zapisać połączenia chmury.'); }
  });
  return router;
}
