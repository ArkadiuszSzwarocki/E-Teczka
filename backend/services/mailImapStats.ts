import { getAccountSyncCursor, getMailAccounts } from './mailInboxStore';
import { createImapClient, type MailboxStats } from './mailSyncProgress';

export type ImapConnectionTestResult = {
  ok: true;
  mailbox: string;
  totalMessages: number;
  unreadMessages: number;
};

function describeImapError(error: unknown, host: string, port: number, mailbox: string): string {
  const err = error as { message?: string; responseText?: string; code?: string; responseStatus?: string };
  const serverText = (err?.responseText || '').trim();
  const raw = `${serverText} ${err?.message || ''}`.toLowerCase();
  const code = (err?.code || '').toUpperCase();
  const detail = serverText ? ` (Serwer ${host}: „${serverText}”)` : '';
  if (raw.includes('disabled') || raw.includes('wyłącz') || raw.includes('pop3/imap')) {
    return `Dostęp IMAP jest wyłączony na tym koncie pocztowym. Włącz IMAP w ustawieniach poczty (np. WP Poczta → Opcje → Dostęp z programów pocztowych).${detail}`;
  }
  if (raw.includes('authentication') || raw.includes('invalid credentials') || raw.includes('login failed') || raw.includes('auth')) {
    return `Serwer ${host} odrzucił logowanie IMAP. Sprawdź: 1) czy w ustawieniach poczty (np. WP → Opcje → Programy pocztowe) masz włączony dostęp IMAP, 2) jeśli masz logowanie dwuetapowe, użyj hasła aplikacji zamiast zwykłego hasła, 3) poprawność loginu i hasła.${detail}`;
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Nie znaleziono serwera IMAP „${host}”. Sprawdź adres serwera i połączenie z internetem.`;
  }
  if (code === 'ECONNREFUSED') {
    return `Serwer „${host}” odrzucił połączenie na porcie ${port}. Sprawdź port i ustawienie SSL/TLS.`;
  }
  if (code === 'ETIMEDOUT' || raw.includes('timeout')) {
    return `Przekroczono czas połączenia z ${host}:${port}. Sprawdź internet, port lub zaporę.`;
  }
  if (raw.includes('mailbox') && (raw.includes('exist') || raw.includes('not found') || raw.includes('unknown'))) {
    return `Zalogowano poprawnie, ale folder „${mailbox}” nie istnieje na serwerze.${detail}`;
  }
  return serverText || err?.message || 'Nie udało się połączyć ze skrzynką IMAP.';
}

/** Tests TCP/TLS connectivity, IMAP authentication, and folder access for the given credentials. */
export async function testImapConnection(config: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox?: string;
}): Promise<ImapConnectionTestResult> {
  const mailbox = (config.mailbox || 'INBOX').trim() || 'INBOX';
  const client = createImapClient({
    id: 'test',
    label: config.user,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    password: config.password,
    mailbox,
  });
  try {
    await client.connect();
    const status = await client.status(mailbox, { messages: true, unseen: true });
    const totalMessages = status && typeof status === 'object' ? Number(status.messages || 0) : 0;
    const unreadMessages = status && typeof status === 'object' ? Number(status.unseen || 0) : 0;
    return { ok: true, mailbox, totalMessages, unreadMessages };
  } catch (error) {
    throw new Error(describeImapError(error, config.host, config.port, mailbox));
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Quickly checks total, unread, checked, and new message counts via IMAP STATUS without downloading bodies. */
export async function fetchMailboxStats(ownerId: number, accountId?: string): Promise<MailboxStats> {
  const accounts = getMailAccounts(ownerId);
  if (accounts.length === 0) throw new Error('Najpierw skonfiguruj połączenie ze skrzynką pocztową (IMAP).');
  const targets = accountId ? accounts.filter(a => a.id === accountId) : accounts;
  if (targets.length === 0) throw new Error('Nie znaleziono wskazanej skrzynki pocztowej.');

  const results: MailboxStats['accounts'] = [];
  for (const cfg of targets) {
    const client = createImapClient(cfg);
    try {
      await client.connect();
      const mailbox = cfg.mailbox || 'INBOX';
      const status = await client.status(mailbox, { messages: true, unseen: true, uidNext: true, uidValidity: true });
      const totalMessages = status && typeof status === 'object' ? Number(status.messages || 0) : 0;
      const unreadMessages = status && typeof status === 'object' ? Number(status.unseen || 0) : 0;
      const uidNext = status && typeof status === 'object' ? Number(status.uidNext || 0) : 0;
      const uidValidity = status && typeof status === 'object' ? Number(status.uidValidity || 0) : 0;
      const cursor = getAccountSyncCursor(ownerId, cfg.id);
      let checkedMessages = 0;
      let newMessages = totalMessages;
      if (cursor && (!uidValidity || !cursor.uidValidity || cursor.uidValidity === uidValidity)) {
        if (cursor.resumeSeq && cursor.resumeSeq > 1) {
          checkedMessages = Math.min(totalMessages, cursor.resumeSeq - 1);
          newMessages = Math.max(0, totalMessages - checkedMessages);
        } else if (cursor.lastUid > 0) {
          if (uidNext > 0 && uidNext <= cursor.lastUid + 1) {
            checkedMessages = totalMessages;
            newMessages = 0;
          } else {
            const lock = await client.getMailboxLock(mailbox);
            try {
              const found = await client.search({ uid: `${cursor.lastUid + 1}:*` }, { uid: true });
              const newer = (Array.isArray(found) ? found : []).filter(u => u > cursor.lastUid).length;
              newMessages = newer;
              checkedMessages = Math.max(0, totalMessages - newer);
            } finally {
              lock.release();
            }
          }
        }
      }
      results.push({ id: cfg.id, user: cfg.user, mailbox, totalMessages, unreadMessages, checkedMessages, newMessages });
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  return {
    totalMessages: results.reduce((sum, r) => sum + r.totalMessages, 0),
    unreadMessages: results.reduce((sum, r) => sum + r.unreadMessages, 0),
    checkedMessages: results.reduce((sum, r) => sum + r.checkedMessages, 0),
    newMessages: results.reduce((sum, r) => sum + r.newMessages, 0),
    accounts: results,
  };
}
