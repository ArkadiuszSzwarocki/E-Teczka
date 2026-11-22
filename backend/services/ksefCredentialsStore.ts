import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { securityDir } from '../config/paths';
import { decrypt, encrypt } from './backupCrypto';

export type KsefEnvironment = 'test' | 'demo' | 'prod';

export type KsefConfigRecord = {
  nip: string;
  token: string;
  environment: KsefEnvironment;
  targetFolderId: number | null;
  schedule: 'manual' | 'daily';
  lastSyncAt?: string | null;
  lastSyncCount?: number;
  lastSyncError?: string | null;
};

export type PublicKsefConfig = {
  configured: boolean;
  nip: string;
  environment: KsefEnvironment;
  targetFolderId: number | null;
  schedule: 'manual' | 'daily';
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncCount: number;
  lastSyncError: string | null;
};

const CONFIG_FILE = path.join(securityDir, 'ksef-config.enc');

function readAll(): Record<string, KsefConfigRecord> {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(decrypt(raw)) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, KsefConfigRecord>) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return {};
  }
}

function writeAll(data: Record<string, KsefConfigRecord>): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, encrypt(JSON.stringify(data)), { mode: 0o600 });
  try {
    fs.renameSync(tmp, CONFIG_FILE);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export function normalizeNip(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

export function getKsefConfig(ownerId: number): KsefConfigRecord | null {
  return readAll()[`user:${ownerId}`] || null;
}

export function getPublicKsefConfig(ownerId: number): PublicKsefConfig {
  const cfg = getKsefConfig(ownerId);
  if (!cfg) {
    return {
      configured: false,
      nip: '',
      environment: 'test',
      targetFolderId: null,
      schedule: 'manual',
      hasToken: false,
      lastSyncAt: null,
      lastSyncCount: 0,
      lastSyncError: null,
    };
  }
  return {
    configured: Boolean(cfg.nip && cfg.token),
    nip: cfg.nip,
    environment: cfg.environment,
    targetFolderId: cfg.targetFolderId ?? null,
    schedule: cfg.schedule || 'manual',
    hasToken: Boolean(cfg.token),
    lastSyncAt: cfg.lastSyncAt ?? null,
    lastSyncCount: Number(cfg.lastSyncCount || 0),
    lastSyncError: cfg.lastSyncError ?? null,
  };
}

export function saveKsefConfig(ownerId: number, input: {
  nip: string;
  token?: string;
  environment?: KsefEnvironment;
  targetFolderId?: number | null;
  schedule?: 'manual' | 'daily';
}): PublicKsefConfig {
  const nip = normalizeNip(input.nip);
  if (!/^\d{10}$/.test(nip)) throw new Error('NIP musi składać się z dokładnie 10 cyfr.');
  const all = readAll();
  const prev = all[`user:${ownerId}`];
  const token = (input.token || '').trim() || prev?.token || '';
  if (!token) throw new Error('Podaj token autoryzacyjny KSeF wygenerowany w portalu MF.');
  const env: KsefEnvironment = input.environment === 'prod' || input.environment === 'demo' ? input.environment : 'test';
  all[`user:${ownerId}`] = {
    nip,
    token,
    environment: env,
    targetFolderId: input.targetFolderId ?? prev?.targetFolderId ?? null,
    schedule: input.schedule === 'daily' ? 'daily' : 'manual',
    lastSyncAt: prev?.lastSyncAt ?? null,
    lastSyncCount: prev?.lastSyncCount ?? 0,
    lastSyncError: null,
  };
  writeAll(all);
  return getPublicKsefConfig(ownerId);
}

export function updateKsefSyncStatus(ownerId: number, status: { lastSyncAt: string; lastSyncCount: number; lastSyncError: string | null }): void {
  const all = readAll();
  const prev = all[`user:${ownerId}`];
  if (!prev) return;
  all[`user:${ownerId}`] = { ...prev, ...status };
  writeAll(all);
}

export function deleteKsefConfig(ownerId: number): boolean {
  const all = readAll();
  if (!all[`user:${ownerId}`]) return false;
  delete all[`user:${ownerId}`];
  writeAll(all);
  return true;
}

export function listScheduledKsefOwners(): number[] {
  const all = readAll();
  const owners: number[] = [];
  for (const [key, cfg] of Object.entries(all)) {
    const match = /^user:(\d+)$/.exec(key);
    if (match && cfg.schedule === 'daily' && cfg.nip && cfg.token) {
      owners.push(Number(match[1]));
    }
  }
  return owners;
}
