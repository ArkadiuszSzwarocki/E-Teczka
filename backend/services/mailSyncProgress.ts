import { ImapFlow } from 'imapflow';
import type { MailAccountConfig } from './mailInboxStore';

export type MailSyncProgress = {
  active: boolean;
  phase: 'idle' | 'connecting' | 'scanning' | 'downloading' | 'paused' | 'done' | 'error';
  accountUser: string;
  scannedMessages: number;
  totalMessages: number;
  candidateMessages: number;
  processedCandidates: number;
  addedAttachments: number;
  etaSeconds?: number | null;
  message: string;
};

export type MailboxStats = {
  totalMessages: number;
  unreadMessages: number;
  checkedMessages: number;
  newMessages: number;
  accounts: Array<{
    id: string;
    user: string;
    mailbox: string;
    totalMessages: number;
    unreadMessages: number;
    checkedMessages: number;
    newMessages: number;
  }>;
};

const syncProgressMap = new Map<number, MailSyncProgress>();
export const stopRequestedSet = new Set<number>();
export const activeSyncOwners = new Set<number>();
export const activeClients = new Map<number, ImapFlow>();

export function createImapClient(cfg: MailAccountConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
  });
}

export function forceCloseActiveClient(ownerId: number): void {
  const client = activeClients.get(ownerId);
  if (client) {
    try { client.close(); } catch { /* ignore */ }
    activeClients.delete(ownerId);
  }
}

export function getMailSyncProgress(ownerId: number): MailSyncProgress {
  return syncProgressMap.get(ownerId) || {
    active: false,
    phase: 'idle',
    accountUser: '',
    scannedMessages: 0,
    totalMessages: 0,
    candidateMessages: 0,
    processedCandidates: 0,
    addedAttachments: 0,
    etaSeconds: null,
    message: '',
  };
}

export function setProgress(ownerId: number, patch: Partial<MailSyncProgress>): void {
  const current = getMailSyncProgress(ownerId);
  syncProgressMap.set(ownerId, { ...current, ...patch });
}

export function requestMailSyncStop(ownerId: number): void {
  stopRequestedSet.add(ownerId);
  forceCloseActiveClient(ownerId);
  const current = getMailSyncProgress(ownerId);
  if (current.active) {
    syncProgressMap.set(ownerId, {
      ...current,
      active: false,
      phase: 'paused',
      message: 'Wstrzymano skanowanie.',
    });
  }
}

export function resetMailSyncState(ownerId: number): void {
  stopRequestedSet.add(ownerId);
  forceCloseActiveClient(ownerId);
  syncProgressMap.set(ownerId, {
    active: false,
    phase: 'idle',
    accountUser: '',
    scannedMessages: 0,
    totalMessages: 0,
    candidateMessages: 0,
    processedCandidates: 0,
    addedAttachments: 0,
    etaSeconds: null,
    message: 'Zresetowano postęp skanowania.',
  });
}
