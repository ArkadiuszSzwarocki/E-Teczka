import { XMLParser } from 'fast-xml-parser';

export type WebDavConnection = { endpoint: string; username: string; password: string };
const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];

function segments(folder: string): string[] {
  const parts = folder.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))) throw new Error('Nieprawidłowa ścieżka folderu.');
  return parts;
}
export function normalizeWebDavEndpoint(endpoint: string): string {
  let base: URL;
  const value = endpoint.trim();
  try { base = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`); } catch { throw new Error('Podaj adres IP lub nazwę serwera NAS, opcjonalnie z portem i ścieżką WebDAV.'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Podaj prawidłowy adres HTTPS usługi WebDAV bez danych logowania.');
  return base.toString().replace(/\/$/, '');
}
function target(connection: WebDavConnection, folder: string): URL {
  const base = new URL(normalizeWebDavEndpoint(connection.endpoint));
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/${segments(folder).map(encodeURIComponent).join('/')}${folder ? '/' : ''}`;
  return base;
}
export function webDavFileUrl(endpoint: string, folder: string, filename: string): string {
  const directory = target({ endpoint, username: '', password: '' }, folder);
  return new URL(encodeURIComponent(filename), directory.toString().replace(/\/?$/, '/')).toString();
}
export function webDavFolderUrl(endpoint: string, folder: string): string {
  return target({ endpoint, username: '', password: '' }, folder).toString();
}
async function request(connection: WebDavConnection, folder: string, method: string) {
  const response = await fetch(target(connection, folder), { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}`, ...(method === 'PROPFIND' ? { Depth: '1', 'Content-Type': 'application/xml' } : {}) }, ...(method === 'PROPFIND' ? { body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><displayname/></prop></propfind>' } : {}) });
  if (!response.ok) throw new Error(`Serwer WebDAV odrzucił żądanie (HTTP ${response.status}). Sprawdź adres, dane logowania i uprawnienia.`);
  return response;
}
export async function listWebDavFolders(connection: WebDavConnection, folder: string) {
  const current = target(connection, folder); const response = await request(connection, folder, 'PROPFIND');
  const text = await response.text(); if (text.length > 2_000_000) throw new Error('Odpowiedź serwera jest zbyt duża.');
  const parsed = parser.parse(text) as { multistatus?: { response?: unknown } };
  const results: { name: string; path: string }[] = [];
  for (const entry of array(parsed.multistatus?.response) as Array<{ href?: string; propstat?: unknown }>) {
    if (typeof entry.href !== 'string') continue;
    const resource = new URL(entry.href, current); if (resource.origin !== current.origin) continue;
    const parentPath = current.pathname.replace(/\/+$/, '') + '/';
    if (!resource.pathname.startsWith(parentPath)) continue;
    const relative = resource.pathname.slice(parentPath.length).replace(/\/+$/, '');
    if (!relative || relative.includes('/')) continue;
    const properties = array(entry.propstat) as Array<{ status?: string; prop?: { resourcetype?: { collection?: unknown } } }>;
    if (!properties.some(item => /\s2\d\d\s/.test(item.status || '') && item.prop?.resourcetype && Object.prototype.hasOwnProperty.call(item.prop.resourcetype, 'collection'))) continue;
    let name: string; try { name = decodeURIComponent(relative); } catch { continue; }
    try { segments(name); if (name.includes('/')) continue; } catch { continue; }
    results.push({ name, path: [...segments(folder), name].join('/') });
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}
export async function createWebDavFolder(connection: WebDavConnection, folder: string, name: string) {
  if (!name.trim() || name !== name.trim() || name.includes('/') || segments(name).length !== 1) throw new Error('Podaj prawidłową nazwę folderu bez ukośników.');
  await request(connection, [...segments(folder), name].join('/'), 'MKCOL');
}

/** Find a backup in the selected directory without trusting paths returned by the server. */
export function findLatestWebDavBackup(xml: string, folderUrl: string): string | null {
  if (xml.length > 2_000_000) throw new Error('Lista plików NAS-a jest zbyt duża.');
  const current = new URL(folderUrl);
  const parsed = parser.parse(xml) as { multistatus?: { response?: unknown } | string };
  if (parsed.multistatus === '') return null;
  if (!parsed.multistatus || typeof parsed.multistatus !== 'object') throw new Error('NAS zwrócił nieprawidłową listę WebDAV.');
  const parent = `${current.pathname.replace(/\/+$/, '')}/`;
  const candidates: Array<{ name: string; modified: number }> = [];
  for (const entry of array(parsed.multistatus.response) as Array<{ href?: string; propstat?: unknown }>) {
    if (typeof entry.href !== 'string') continue;
    let url: URL; try { url = new URL(entry.href, current); } catch { continue; }
    if (url.origin !== current.origin || !url.pathname.startsWith(parent)) continue;
    const relative = url.pathname.slice(parent.length);
    if (!relative || relative.includes('/') || url.search || url.hash) continue;
    let name: string; try { name = decodeURIComponent(relative); } catch { continue; }
    if (!name.toLowerCase().endsWith('.zip.enc') || name.includes('/') || name.includes('\\') || name === '..') continue;
    const props = array(entry.propstat) as Array<{ status?: string; prop?: { resourcetype?: unknown; getlastmodified?: unknown } }>;
    const prop = props.find(item => /\s2\d\d\s/.test(item.status || ''))?.prop;
    if (!prop) continue;
    if (prop.resourcetype && typeof prop.resourcetype === 'object' && Object.prototype.hasOwnProperty.call(prop.resourcetype, 'collection')) continue;
    const modified = typeof prop.getlastmodified === 'string' ? Date.parse(prop.getlastmodified) : NaN;
    candidates.push({ name, modified: Number.isFinite(modified) ? modified : 0 });
  }
  candidates.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
  return candidates[0]?.name || null;
}
