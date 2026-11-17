import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import * as archiver from 'archiver';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { exportPlanState } from './planLedger';
import { decrypt, encrypt, encryptBackup } from './backupCrypto';
import { findLatestWebDavBackup, listWebDavBackups, webDavFileUrl, webDavFolderUrl } from './webdavFolders';

export const oauthConfig: Record<string, { authorize: string; token: string; scope: string; clientId?: string; clientSecret?: string }> = {
  'google-drive': { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
  dropbox: { authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', scope: 'files.content.write files.content.read', clientId: process.env.DROPBOX_CLIENT_ID, clientSecret: process.env.DROPBOX_CLIENT_SECRET },
  onedrive: { authorize: 'https://login.microsoftonline.com/common/v2.0/authorize', token: 'https://login.microsoftonline.com/common/v2.0/token', scope: 'Files.ReadWrite.AppFolder offline_access', clientId: process.env.ONEDRIVE_CLIENT_ID, clientSecret: process.env.ONEDRIVE_CLIENT_SECRET },
};

export const oauthCallbackUrl = () => process.env.ETECZKA_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/backup/oauth/callback';

export function backupFilename(now = new Date()) {
  return `eteczka-${now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.zip.enc`;
}

export function backupFiles(documents: Array<{ id: number; filePath: string }>) {
  return documents.map(document => ({ source: path.join(uploadsDir, document.filePath), archiveName: `files/${document.id}-${path.basename(document.filePath)}` }));
}

export function requireBackupFiles(files: ReturnType<typeof backupFiles>) {
  const missing = files.find(file => !fs.existsSync(file.source));
  if (missing) throw new Error('Brak pliku dokumentu na dysku. Kopia nie została utworzona.');
}

export async function buildBackupArchive(prisma: PrismaClient, ownerIdValue: number, planKey: string) {
  const folders = await prisma.folder.findMany({ where: { ownerId: ownerIdValue }, orderBy: { id: 'asc' } });
  const documents = await prisma.document.findMany({ where: { folder: { ownerId: ownerIdValue } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
  const files = backupFiles(documents);
  requireBackupFiles(files);
  const manifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    planState: await exportPlanState(prisma, planKey),
    folders,
    documents: documents.map(({ tags, ...document }) => ({ ...document, tags: tags.map(({ tag }) => tag) })),
  };
  return { manifest, files };
}

export async function buildEncryptedBackupBuffer(prisma: PrismaClient, ownerIdValue: number, planKey: string): Promise<Buffer> {
  const { manifest, files } = await buildBackupArchive(prisma, ownerIdValue, planKey);
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
  const archive = new (archiver as any).ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (error: Error) => pass.destroy(error));
  archive.pipe(pass);
  archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
  for (const file of files) archive.file(file.source, { name: file.archiveName });
  const complete = new Promise<void>((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
  await archive.finalize();
  await complete;
  return encryptBackup(Buffer.concat(chunks));
}

export async function refreshOAuthCredentials(prisma: PrismaClient, destination: { id: number; ownerKey: string; provider: string; encryptedCredentials: string | null }) {
  const credentials = destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) as { accessToken?: string; refreshToken?: string; expiresAt?: number } : {};
  if (!credentials.refreshToken || !credentials.expiresAt || credentials.expiresAt > Date.now() + 60_000) return credentials;
  const config = oauthConfig[destination.provider];
  if (!config?.clientId || !config.clientSecret) return credentials;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: config.clientId, client_secret: config.clientSecret });
  const response = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!response.ok || !tokens.access_token) throw new Error('Nie udało się odświeżyć tokenu OAuth.');
  const updated = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
  await prisma.backupDestination.update({ where: { id: destination.id }, data: { encryptedCredentials: encrypt(JSON.stringify(updated)) } });
  return updated;
}

type DestinationRecord = { provider: string; endpoint: string | null; remoteFolder: string | null };
type CloudCredentials = { accessToken?: string; username?: string; password?: string };

export async function uploadEncryptedBackupToCloud(destination: DestinationRecord, credentials: CloudCredentials, data: Buffer, filename = backupFilename()): Promise<Response> {
  const folder = destination.remoteFolder ? destination.remoteFolder.replace(/^\/+|\/+$/g, '') : '';
  const payloadBody = new Uint8Array(data);
  if (destination.provider === 'webdav') {
    const target = webDavFileUrl(destination.endpoint!, destination.remoteFolder || '', filename);
    return fetch(target, { method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}`, 'Content-Type': 'application/zip' }, body: payloadBody });
  }
  if (destination.provider === 'dropbox') {
    return fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${folder ? `${folder}/` : ''}${filename}`, mode: 'add', autorename: true }), 'Content-Type': 'application/octet-stream' }, body: payloadBody });
  }
  if (destination.provider === 'onedrive') {
    return fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${folder ? `${folder}/` : ''}${filename}:/content`, { method: 'PUT', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/zip' }, body: payloadBody });
  }
  const metadata = JSON.stringify({ name: filename, mimeType: 'application/zip', ...(destination.remoteFolder ? { parents: [destination.remoteFolder] } : {}) });
  const multipart = `----EtecZkaBoundary${Date.now()}`;
  const body = Buffer.concat([Buffer.from(`--${multipart}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${multipart}\r\nContent-Type: application/zip\r\n\r\n`), data, Buffer.from(`\r\n--${multipart}--`)]);
  return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart}` }, body: new Uint8Array(body) });
}

export async function listCloudBackups(destination: DestinationRecord, credentials: CloudCredentials): Promise<{ ok: true; backups: Array<{ name: string; modifiedAt: string | null }> } | { ok: false; status: number; error: string }> {
  const folder = destination.remoteFolder ? `/${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}` : '';
  if (destination.provider === 'dropbox') {
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folder, recursive: false }) });
    const payload = await response.json() as { entries?: Array<{ name?: string; server_modified?: string }> };
    if (!response.ok) throw new Error('Dropbox list failed');
    return { ok: true, backups: (payload.entries || []).filter(e => e.name?.endsWith('.zip.enc')).sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified))).map(e => ({ name: e.name!, modifiedAt: e.server_modified || null })) };
  }
  if (destination.provider === 'onedrive') {
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:${folder}:/children`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    const payload = await response.json() as { value?: Array<{ name?: string; lastModifiedDateTime?: string }> };
    if (!response.ok) throw new Error('OneDrive list failed');
    return { ok: true, backups: (payload.value || []).filter(e => e.name?.endsWith('.zip.enc')).sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime))).map(e => ({ name: e.name!, modifiedAt: e.lastModifiedDateTime || null })) };
  }
  if (destination.provider === 'google-drive') {
    const q = `name contains '.zip.enc' and trashed = false${destination.remoteFolder ? ` and '${destination.remoteFolder}' in parents` : ''}`;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime%20desc&pageSize=50&fields=files(name,modifiedTime)&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    const payload = await response.json() as { files?: Array<{ name?: string; modifiedTime?: string }> };
    if (!response.ok) throw new Error('Google Drive list failed');
    return { ok: true, backups: (payload.files || []).filter(e => e.name).map(e => ({ name: e.name!, modifiedAt: e.modifiedTime || null })) };
  }
  const base = webDavFolderUrl(destination.endpoint!, destination.remoteFolder || '');
  const response = await fetch(base, { method: 'PROPFIND', redirect: 'error', headers: { Depth: '1', 'Content-Type': 'application/xml', Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getlastmodified/></prop></propfind>' });
  if (!response.ok) return { ok: false, status: 502, error: `NAS nie udostępnił listy kopii (HTTP ${response.status}). Sprawdź dane logowania i dostęp do folderu.` };
  return { ok: true, backups: listWebDavBackups(await response.text(), base) };
}

export async function downloadCloudBackup(destination: DestinationRecord, credentials: CloudCredentials, requestedFilename: string): Promise<{ ok: true; buffer: Buffer } | { ok: false; status: number; error: string }> {
  let filename = requestedFilename;
  if (!filename) {
    if (destination.provider === 'webdav') {
      const base = webDavFolderUrl(destination.endpoint!, destination.remoteFolder || '');
      const listRes = await fetch(base, { method: 'PROPFIND', redirect: 'error', headers: { Depth: '1', 'Content-Type': 'application/xml', Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getlastmodified/></prop></propfind>' });
      if (!listRes.ok) return { ok: false, status: 502, error: `NAS nie udostępnił listy kopii (HTTP ${listRes.status}). Sprawdź dane logowania i dostęp do folderu.` };
      filename = findLatestWebDavBackup(await listRes.text(), base) || '';
    } else {
      const listed = await listCloudBackups(destination, credentials);
      if (!listed.ok) return listed;
      filename = listed.backups[0]?.name || '';
    }
  }
  if (!filename) return { ok: false, status: 404, error: 'Nie znaleziono zaszyfrowanej kopii.' };

  const folder = destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : '';
  let response: Response;
  if (destination.provider === 'dropbox') {
    response = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${folder}${filename}` }) } });
  } else if (destination.provider === 'onedrive') {
    response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${folder}${filename}:/content`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  } else if (destination.provider === 'google-drive') {
    const search = await fetch(`https://www.googleapis.com/drive/v3/files?fields=files(id)&pageSize=1&q=${encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and trashed = false`)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
    const found = await search.json() as { files?: Array<{ id?: string }> };
    if (!search.ok || !found.files?.[0]?.id) throw new Error('Google Drive file not found');
    response = await fetch(`https://www.googleapis.com/drive/v3/files/${found.files[0].id}?alt=media`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  } else {
    response = await fetch(webDavFileUrl(destination.endpoint!, destination.remoteFolder || '', filename), { redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` } });
  }
  if (!response.ok) return { ok: false, status: 502, error: `Nie udało się pobrać kopii (HTTP ${response.status}).` };
  return { ok: true, buffer: Buffer.from(await response.arrayBuffer()) };
}
