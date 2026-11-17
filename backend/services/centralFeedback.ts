import fs from 'node:fs';
import path from 'node:path';
import { centralAccountOrigin } from './centralAccountLink';

export type FeedbackCategory = 'bug' | 'feedback' | 'backup' | 'other';
export type FeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'closed';

export type SubmitFeedbackPayload = {
  category: FeedbackCategory;
  title: string;
  description: string;
  contactEmail?: string;
  appVersion?: string;
  platform?: string;
  activeView?: string;
  screenshotDataUrl?: string;
};

export type CentralFeedbackItem = {
  id: number;
  accountId: number | null;
  accountEmail: string | null;
  contactEmail: string | null;
  category: FeedbackCategory;
  title: string;
  description: string;
  appVersion: string | null;
  platform: string | null;
  activeView: string | null;
  screenshotDataUrl: string | null;
  status: FeedbackStatus;
  createdAt: number;
};

function adminSettings() {
  const origin = centralAccountOrigin(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
  if (!origin) return null;
  let key = process.env.CENTRAL_CATALOG_ADMIN_TOKEN;
  try {
    if (!key) {
      const envFile = path.resolve(__dirname, '../../central-accounts/.env');
      key = (require('node:util').parseEnv(fs.readFileSync(envFile, 'utf8')) as { CENTRAL_CATALOG_ADMIN_TOKEN?: string }).CENTRAL_CATALOG_ADMIN_TOKEN;
    }
  } catch {
    /* Installed applications do not have this developer-only file. */
  }
  return key ? { origin, key } : null;
}

/** Sends a user bug/feedback report with optional screenshot to the central QNAP API. */
export async function submitCentralFeedback(payload: SubmitFeedbackPayload): Promise<{ id: number; status: string; createdAt: number }> {
  const origin = centralAccountOrigin(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
  if (!origin) throw new Error('Adres serwera QNAP nie jest skonfigurowany.');
  const response = await fetch(`${origin}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({})) as { id?: number; status?: string; createdAt?: number; error?: string };
  if (!response.ok || typeof body.id !== 'number') {
    throw new Error(body.error || 'Nie udało się wysłać zgłoszenia do serwera QNAP.');
  }
  return { id: body.id, status: body.status || 'new', createdAt: Number(body.createdAt || Date.now()) };
}

let cachedFeedback: { items: CentralFeedbackItem[]; at: number } | null = null;
const FEEDBACK_CACHE_TTL_MS = 30_000;

/** Lists feedback reports stored in MariaDB on QNAP (developer-only). */
export async function listCentralFeedback(status?: string): Promise<CentralFeedbackItem[]> {
  if (!status && cachedFeedback && Date.now() - cachedFeedback.at < FEEDBACK_CACHE_TTL_MS) {
    return cachedFeedback.items;
  }
  const config = adminSettings();
  if (!config) throw new Error('Brak konfiguracji administratora QNAP.');
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await fetch(`${config.origin}/admin/feedback${query}`, {
    headers: { authorization: `Bearer ${config.key}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 429 && cachedFeedback) {
    return status ? cachedFeedback.items.filter(item => item.status === status) : cachedFeedback.items;
  }
  const body = await response.json().catch(() => ({})) as { items?: CentralFeedbackItem[]; error?: string };
  if (!response.ok) throw new Error(body.error || 'Nie udało się pobrać zgłoszeń z QNAP-a.');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!status) cachedFeedback = { items, at: Date.now() };
  return items;
}

/** Updates a feedback report status in MariaDB on QNAP (developer-only). */
export async function updateCentralFeedbackStatus(id: number, status: FeedbackStatus): Promise<{ id: number; status: FeedbackStatus }> {
  const config = adminSettings();
  if (!config) throw new Error('Brak konfiguracji administratora QNAP.');
  const response = await fetch(`${config.origin}/admin/feedback/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ status }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({})) as { id?: number; status?: FeedbackStatus; error?: string };
  if (!response.ok) throw new Error(body.error || 'Nie udało się zmienić statusu zgłoszenia.');
  if (cachedFeedback) {
    cachedFeedback = {
      at: Date.now(),
      items: cachedFeedback.items.map(item => (item.id === id ? { ...item, status: body.status || status } : item)),
    };
  }
  return { id: Number(body.id || id), status: body.status || status };
}
