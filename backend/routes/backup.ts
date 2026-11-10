import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PassThrough } from 'stream';
import * as archiver from 'archiver';
import AdmZip from 'adm-zip';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { authSecret } from '../security/authSecret';
import { hasPremium, billingOwnerKey } from '../middleware/premium';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
const BACKUP_SECRET = crypto.createHash('sha256').update(authSecret()).digest();
const allowedProviders = new Set(['webdav', 'google-drive', 'onedrive', 'dropbox']);
const oauthStates = new Map<string, { ownerKey: string; provider: string; expiresAt: number }>();
const oauthConfig: Record<string, { authorize: string; token: string; scope: string; clientId?: string; clientSecret?: string }> = {
  'google-drive': { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
  dropbox: { authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', scope: 'files.content.write files.content.read', clientId: process.env.DROPBOX_CLIENT_ID, clientSecret: process.env.DROPBOX_CLIENT_SECRET },
  onedrive: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'Files.ReadWrite.AppFolder offline_access', clientId: process.env.ONEDRIVE_CLIENT_ID, clientSecret: process.env.ONEDRIVE_CLIENT_SECRET },
};
const oauthCallbackUrl = () => process.env.ETECZKA_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/backup/oauth/callback';

function encrypt(value: string) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', BACKUP_SECRET, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`; }
function decrypt(value: string) { const [ivRaw, tagRaw, dataRaw] = value.split('.'); const decipher = crypto.createDecipheriv('aes-256-gcm', BACKUP_SECRET, Buffer.from(ivRaw, 'base64url')); decipher.setAuthTag(Buffer.from(tagRaw, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8'); }
function encryptBackup(data: Buffer) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', BACKUP_SECRET, iv); const encrypted = Buffer.concat([cipher.update(data), cipher.final()]); return Buffer.concat([Buffer.from('ETECZKA-BACKUP-1\n'), iv, cipher.getAuthTag(), encrypted]); }
function decryptBackup(data: Buffer) {
  const header = Buffer.from('ETECZKA-BACKUP-1\n');
  if (!data.subarray(0, header.length).equals(header)) return data;
  const ivStart = header.length; const tagStart = ivStart + 12; const payloadStart = tagStart + 16;
  if (data.length <= payloadStart) throw new Error('Uszkodzona zaszyfrowana kopia.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', BACKUP_SECRET, data.subarray(ivStart, tagStart));
  decipher.setAuthTag(data.subarray(tagStart, payloadStart));
  return Buffer.concat([decipher.update(data.subarray(payloadStart)), decipher.final()]);
}
async function refreshOAuthCredentials(prisma: PrismaClient, destination: { id: number; ownerKey: string; provider: string; encryptedCredentials: string | null }) {
  const credentials = destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) as { accessToken?: string; refreshToken?: string; expiresAt?: number } : {};
  if (!credentials.refreshToken || !credentials.expiresAt || credentials.expiresAt > Date.now() + 60_000) return credentials;
  const config = oauthConfig[destination.provider]; if (!config?.clientId || !config.clientSecret) return credentials;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: config.clientId, client_secret: config.clientSecret });
  const response = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !tokens.access_token) throw new Error('Nie udało się odświeżyć tokenu OAuth.');
  const updated = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
  await prisma.backupDestination.update({ where: { id: destination.id }, data: { encryptedCredentials: encrypt(JSON.stringify(updated)) } });
  return updated;
}
async function isPremium(prisma: PrismaClient, res: express.Response) { return hasPremium(prisma, res); }

export function createBackupRouter(prisma: PrismaClient) {
  const router = express.Router();

  router.get('/oauth/:provider/start', async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Integracje chmurowe wymagają Premium.' });
    const provider = String(req.params.provider); const config = oauthConfig[provider];
    if (!config || !config.clientId || !config.clientSecret) return res.status(503).json({ error: `Brak konfiguracji OAuth dla ${provider}.` });
    const state = crypto.randomBytes(24).toString('base64url'); oauthStates.set(state, { ownerKey: billingOwnerKey(res), provider, expiresAt: Date.now() + 10 * 60_000 });
    const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthCallbackUrl(), response_type: 'code', state, scope: config.scope });
    if (provider === 'google-drive') params.set('access_type', 'offline');
    res.redirect(`${config.authorize}?${params.toString()}`);
  });

  router.get('/destination', async (_req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Backup do chmury wymaga planu Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    res.json(destination ? { provider: destination.provider, endpoint: destination.endpoint, remoteFolder: destination.remoteFolder, schedule: destination.schedule, enabled: destination.enabled, configured: true } : { configured: false });
  });

  router.put('/destination', async (req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Backup do chmury wymaga planu Premium.' });
    const provider = String(req.body?.provider || '');
    const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim().slice(0, 2000) : '';
    const remoteFolder = typeof req.body?.remoteFolder === 'string' ? req.body.remoteFolder.trim().slice(0, 500) : '';
    const schedule = ['manual', 'daily', 'weekly'].includes(String(req.body?.schedule)) ? String(req.body.schedule) : 'manual';
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!allowedProviders.has(provider)) return res.status(400).json({ error: 'Nieobsługiwany dostawca chmury.' });
    if (provider === 'webdav' && (!endpoint || !/^https:\/\//i.test(endpoint))) return res.status(400).json({ error: 'QNAP/WebDAV wymaga adresu HTTPS.' });
    const credentials = provider === 'webdav' ? encrypt(JSON.stringify({ username, password })) : null;
    const destination = await prisma.backupDestination.upsert({ where: { ownerKey: billingOwnerKey(res) }, create: { ownerKey: billingOwnerKey(res), provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials }, update: { provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials, enabled: true } });
    res.json({ provider: destination.provider, endpoint: destination.endpoint, remoteFolder: destination.remoteFolder, schedule: destination.schedule, enabled: destination.enabled, configured: true });
  });

  router.post('/cloud', async (_req, res) => {
    if (!await isPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Automatyczny backup do chmury wymaga planu Premium.' });
    const destination = await prisma.backupDestination.findUnique({ where: { ownerKey: billingOwnerKey(res) } });
    if (!destination?.enabled) return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
    try {
      const folders = await prisma.folder.findMany({ where: { ownerId: ownerId(res) }, orderBy: { id: 'asc' } });
      const documents = await prisma.document.findMany({ where: { folder: { ownerId: ownerId(res) } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
      const manifest = { version: 1, exportedAt: new Date().toISOString(), folders, documents: documents.map(({ tags, ...document }) => ({ ...document, tags: tags.map(({ tag }) => tag) })) };
      const pass = new PassThrough(); const chunks: Buffer[] = []; pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
      const archive = (archiver as any)('zip', { zlib: { level: 6 } }); archive.pipe(pass); archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
      for (const document of documents) { const source = path.join(uploadsDir, document.filePath); if (fs.existsSync(source)) archive.file(source, { name: `files/${document.id}-${path.basename(document.filePath)}` }); }
      const complete = new Promise<void>((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
      await archive.finalize(); await complete;
      const credentials: { username?: string; password?: string; accessToken?: string } = destination.provider === 'webdav' ? (destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) as { username?: string; password?: string } : {}) : await refreshOAuthCredentials(prisma, destination);
      const data = encryptBackup(Buffer.concat(chunks)); const filename = `eteczka-${new Date().toISOString().slice(0, 10)}.zip.enc`;
      let response: Response;
      if (destination.provider === 'webdav') {
        const target = `${destination.endpoint!.replace(/\/$/, '')}/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`;
        response = await fetch(target, { method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}`, 'Content-Type': 'application/zip' }, body: data });
      } else if (destination.provider === 'dropbox') {
        response = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`, mode: 'overwrite', autorename: false }), 'Content-Type': 'application/octet-stream' }, body: data });
      } else if (destination.provider === 'onedrive') {
        response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}:/content`, { method: 'PUT', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/zip' }, body: data });
      } else {
        const metadata = JSON.stringify({ name: filename, mimeType: 'application/zip', ...(destination.remoteFolder ? { parents: [destination.remoteFolder] } : {}) }); const multipart = `----EtecZkaBoundary${Date.now()}`; const body = Buffer.concat([Buffer.from(`--${multipart}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${multipart}\r\nContent-Type: application/zip\r\n\r\n`), data, Buffer.from(`\r\n--${multipart}--`)]);
        response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart}` }, body });
      }
      if (!response.ok) return res.status(502).json({ error: `QNAP/WebDAV odrzucił kopię (HTTP ${response.status}).` });
      res.json({ success: true, provider: destination.provider, uploadedAt: new Date().toISOString() });
    } catch { res.status(502).json({ error: 'Nie udało się wysłać kopii do chmury.' }); }
  });

  router.get('/export', async (req, res) => {
    const currentOwner = ownerId(res);
    const folders = await prisma.folder.findMany({ where: { ownerId: currentOwner }, orderBy: { id: 'asc' } });
    const documents = await prisma.document.findMany({ where: { folder: { ownerId: currentOwner } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders,
      documents: documents.map(({ tags, ...document }) => ({ ...document, tags: tags.map(({ tag }) => tag) })),
    };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    const archive = (archiver as any)('zip', { zlib: { level: 6 } });
    archive.on('error', (error: Error) => { if (!res.headersSent) res.status(500); res.end(); console.error('[backup] export:', error); });
    archive.pipe(res);
    archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
    for (const document of documents) {
      const source = path.join(uploadsDir, document.filePath);
      if (fs.existsSync(source)) archive.file(source, { name: `files/${document.id}-${path.basename(document.filePath)}` });
    }
    await archive.finalize();
  });

  router.post('/restore', upload.single('backup'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Wybierz plik kopii zapasowej.' });
    try {
      const zip = new AdmZip(decryptBackup(req.file.buffer));
      const manifestEntry = zip.getEntry('manifest.json');
      if (!manifestEntry) return res.status(400).json({ error: 'Nieprawidłowa kopia: brak manifestu.' });
      const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as { version?: number; folders?: Array<Record<string, unknown>>; documents?: Array<Record<string, unknown> & { tags?: Array<Record<string, unknown>> }> };
      if (manifest.version !== 1 || !Array.isArray(manifest.folders) || !Array.isArray(manifest.documents)) return res.status(400).json({ error: 'Nieobsługiwana wersja kopii zapasowej.' });
      const currentOwner = ownerId(res);
      const folderMap = new Map<number, number>();
      await prisma.$transaction(async tx => {
        const pending = [...manifest.folders!];
        while (pending.length) {
          const index = pending.findIndex(folder => !folder.parentId || folderMap.has(Number(folder.parentId)));
          if (index < 0) throw new Error('Nieprawidłowa hierarchia kartotek.');
          const source = pending.splice(index, 1)[0];
          const created = await tx.folder.create({ data: { name: String(source.name || 'Przywrócona kartoteka').slice(0, 255), parentId: source.parentId ? folderMap.get(Number(source.parentId)) || null : null, ownerId: currentOwner, order: Number(source.order) || 0 } });
          folderMap.set(Number(source.id), created.id);
        }
        for (const source of manifest.documents!) {
          const folderId = folderMap.get(Number(source.folderId));
          if (!folderId) continue;
          const entryName = `files/${source.id}-${path.basename(String(source.filePath || ''))}`;
          const entry = zip.getEntry(entryName);
          if (!entry) continue;
          const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(String(source.filePath))}`;
          fs.writeFileSync(path.join(uploadsDir, safeName), entry.getData());
          const created = await tx.document.create({ data: { title: String(source.title || 'Przywrócony dokument').slice(0, 255), filePath: safeName, mimeType: String(source.mimeType || 'application/octet-stream'), folderId, userId: res.locals.userId ? currentOwner : null, retentionEnabled: source.retentionEnabled !== false, retentionValue: Number(source.retentionValue) || 5, retentionUnit: String(source.retentionUnit || 'years'), isArchived: Boolean(source.isArchived), isDeleted: false, ocrText: typeof source.ocrText === 'string' ? source.ocrText.slice(0, 100_000) : null } });
          for (const tag of source.tags || []) {
            const tagRecord = await tx.tag.upsert({ where: { name: String(tag.name || '').slice(0, 80) }, create: { name: String(tag.name || 'tag').slice(0, 80), color: String(tag.color || '#2563eb') }, update: {} });
            await tx.documentTag.create({ data: { documentId: created.id, tagId: tagRecord.id } }).catch(() => undefined);
          }
        }
      });
      res.json({ success: true, restoredFolders: manifest.folders.length, restoredDocuments: manifest.documents.length });
    } catch (error) { console.error('[backup] restore:', error); res.status(400).json({ error: 'Nie udało się przywrócić kopii zapasowej.' }); }
  });
  return router;
}

/** Public OAuth callback. Ownership is recovered from the short-lived state token. */
export function createBackupOAuthCallbackRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/callback', async (req, res) => {
    const state = String(req.query.state || ''); const context = oauthStates.get(state); oauthStates.delete(state);
    if (!context || context.expiresAt < Date.now()) return res.status(400).send('Sesja OAuth wygasła. Wróć do E‑Teczki i spróbuj ponownie.');
    const config = oauthConfig[context.provider]; const code = String(req.query.code || '');
    if (!config || !code) return res.status(400).send('Brak kodu autoryzacji OAuth.');
    try {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oauthCallbackUrl(), client_id: config.clientId!, client_secret: config.clientSecret! });
      const tokenResponse = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!tokenResponse.ok || !tokens.access_token) return res.status(502).send('Dostawca chmury odrzucił autoryzację.');
      await prisma.backupDestination.upsert({ where: { ownerKey: context.ownerKey }, create: { ownerKey: context.ownerKey, provider: context.provider, encryptedCredentials: encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true }, update: { provider: context.provider, encryptedCredentials: encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true } });
      res.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka</title><h2>Chmura została połączona.</h2><p>Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p>');
    } catch { res.status(502).send('Nie udało się zapisać połączenia z chmurą.'); }
  });
  return router;
}
