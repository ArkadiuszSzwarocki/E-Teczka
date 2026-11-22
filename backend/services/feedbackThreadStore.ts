import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { securityDir } from '../config/paths';
import type { FeedbackCategory, FeedbackStatus } from './centralFeedback';

export type FeedbackThreadMessage = {
  id: string;
  author: 'user' | 'admin';
  text: string;
  createdAt: number;
};

export type UserFeedbackHistoryItem = {
  id: number;
  category: FeedbackCategory;
  title: string;
  description: string;
  contactEmail: string | null;
  status: FeedbackStatus;
  createdAt: number;
  messages: FeedbackThreadMessage[];
};

const STORE_FILE = () => path.join(securityDir, 'feedback-threads.json');

type StoreData = {
  items: UserFeedbackHistoryItem[];
  threads: Record<string, FeedbackThreadMessage[]>;
};

function readStore(): StoreData {
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_FILE(), 'utf8')) as Partial<StoreData>;
    return {
      items: Array.isArray(raw.items) ? raw.items : [],
      threads: raw.threads && typeof raw.threads === 'object' ? raw.threads : {},
    };
  } catch {
    return { items: [], threads: {} };
  }
}

function writeStore(data: StoreData) {
  const file = STORE_FILE();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function recordFeedbackSubmission(entry: Omit<UserFeedbackHistoryItem, 'messages'>) {
  const data = readStore();
  const key = String(entry.id);
  const existing = data.items.filter(item => item.id !== entry.id);
  data.items = [{ ...entry, messages: data.threads[key] || [] }, ...existing].slice(0, 200);
  writeStore(data);
}

export function getFeedbackThreadMessages(feedbackId: number): FeedbackThreadMessage[] {
  const data = readStore();
  return data.threads[String(feedbackId)] || [];
}

export function listUserFeedbackHistory(): UserFeedbackHistoryItem[] {
  const data = readStore();
  return data.items.map(item => ({
    ...item,
    messages: data.threads[String(item.id)] || item.messages || [],
  }));
}

export function addFeedbackThreadMessage(feedbackId: number, author: 'user' | 'admin', text: string): FeedbackThreadMessage {
  const clean = text.trim();
  if (clean.length < 2 || clean.length > 2000) {
    throw new Error('Wiadomość musi mieć od 2 do 2000 znaków.');
  }
  const data = readStore();
  const key = String(feedbackId);
  const msg: FeedbackThreadMessage = {
    id: crypto.randomUUID(),
    author,
    text: clean,
    createdAt: Date.now(),
  };
  data.threads[key] = [...(data.threads[key] || []), msg];
  data.items = data.items.map(item => (item.id === feedbackId ? { ...item, messages: data.threads[key] } : item));
  writeStore(data);
  return msg;
}

export function updateFeedbackHistoryStatus(feedbackId: number, status: FeedbackStatus) {
  const data = readStore();
  let changed = false;
  data.items = data.items.map(item => {
    if (item.id === feedbackId) {
      changed = true;
      return { ...item, status };
    }
    return item;
  });
  if (changed) writeStore(data);
}

export async function sendFeedbackEmailCopy(input: {
  id: number;
  toEmail: string;
  title: string;
  category: string;
  description: string;
}): Promise<{ sent: boolean; message: string }> {
  const host = process.env.MOJATECZKA_SMTP_HOST;
  const user = process.env.MOJATECZKA_SMTP_USER;
  const pass = process.env.MOJATECZKA_SMTP_PASSWORD;
  const from = process.env.MOJATECZKA_SMTP_FROM;
  if (!host || !user || !pass || !from) {
    return {
      sent: false,
      message: 'Kopia nie została wysłana — serwer poczty SMTP nie jest jeszcze skonfigurowany w zmiennych środowiskowych.',
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer') as {
      createTransport: (opts: unknown) => { sendMail: (mail: unknown) => Promise<unknown> };
    };
    const port = Number(process.env.MOJATECZKA_SMTP_PORT || 465);
    const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    await transport.sendMail({
      from,
      to: input.toEmail,
      subject: `MojaTeczka — kopia zgłoszenia #${input.id}: ${input.title}`,
      text: `Dziękujemy za zgłoszenie w aplikacji MojaTeczka.\n\nNumer zgłoszenia: #${input.id}\nKategoria: ${input.category}\nTemat: ${input.title}\n\nOpis:\n${input.description}\n`,
    });
    return { sent: true, message: `Wysłano kopię zgłoszenia na adres ${input.toEmail}.` };
  } catch {
    return { sent: false, message: 'Nie udało się wysłać wiadomości e-mail. Sprawdź konfigurację SMTP.' };
  }
}
