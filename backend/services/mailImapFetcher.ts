import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { buildMailAutoAssigner, type AutoAssignHandler } from './mailAutoAssigner';
import { extractAndSaveMessageAttachments, hasCandidateAttachment, type AttachmentKind } from './mailAttachmentExtractor';
import { computeScanEta, runImapWorkerPool } from './mailImapPool';
import { fetchMailboxStats } from './mailImapStats';
import {
  addKnownSenders,
  extractSenderEmail,
  getAccountSyncCursor,
  getMailAccounts,
  getMailFilters,
  isSenderExcluded,
  listMailItems,
  markProcessedAttachmentKeys,
  saveAccountSyncCursor,
  type MailAccountConfig,
  type MailInboxItem,
} from './mailInboxStore';
import {
  activeClients,
  activeSyncOwners,
  createImapClient,
  getMailSyncProgress,
  requestMailSyncStop,
  resetMailSyncState,
  setProgress,
  stopRequestedSet,
  type MailboxStats,
  type MailSyncProgress,
} from './mailSyncProgress';

export {
  fetchMailboxStats,
  getMailSyncProgress,
  requestMailSyncStop,
  resetMailSyncState,
  type MailboxStats,
  type MailSyncProgress,
};

type SyncLimit = number | 'all' | 'incremental' | 'unread';

async function syncSingleAccount(
  cfg: MailAccountConfig,
  ownerId: number,
  folders: Array<{ id: number; name: string; parentId: number | null }>,
  existingTitles: Set<string>,
  seenKeys: Set<string>,
  excludedList: string[],
  discoveredSenders: string[],
  maxMessages: SyncLimit,
  senderFolderRules?: Record<string, number>,
  onAutoAssign?: AutoAssignHandler,
  attachmentKind: AttachmentKind = 'documents',
): Promise<{ added: number; scanned: number }> {
  const client = createImapClient(cfg);
  let added = 0;
  let totalScannedForAccount = 0;

  setProgress(ownerId, {
    active: true,
    phase: 'connecting',
    accountUser: cfg.user,
    scannedMessages: 0,
    totalMessages: 0,
    candidateMessages: 0,
    processedCandidates: 0,
    message: `Łączenie ze skrzynką ${cfg.user}…`,
  });

  activeClients.set(ownerId, client);
  try {
    await client.connect();
    const lock = await client.getMailboxLock(cfg.mailbox || 'INBOX');
    try {
      const status = await client.status(cfg.mailbox || 'INBOX', { messages: true, unseen: true, uidNext: true, uidValidity: true });
      const total = status && typeof status === 'object' ? status.messages || 0 : 0;
      const unreadTotal = status && typeof status === 'object' ? Number(status.unseen || 0) : 0;
      const uidValidity = Number((status && typeof status === 'object' ? status.uidValidity : 0) || (client.mailbox && typeof client.mailbox === 'object' ? client.mailbox.uidValidity : 0) || 0);
      const uidNext = Number((status && typeof status === 'object' ? status.uidNext : 0) || 0);
      const cursor = getAccountSyncCursor(ownerId, cfg.id);
      const isUnreadMode = maxMessages === 'unread';
      const hasResume = Boolean(
        !isUnreadMode
        && cursor?.resumeSeq
        && cursor.resumeSeq > 1
        && cursor.resumeSeq <= total
        && cursor.resumeLimit === String(maxMessages)
        && (!uidValidity || cursor.uidValidity === uidValidity),
      );
      const canUseCursor = !isUnreadMode && !hasResume && maxMessages === 'incremental' && cursor && cursor.lastUid > 0 && (!uidValidity || cursor.uidValidity === uidValidity);

      if (total > 0) {
        if (canUseCursor && uidNext > 0 && uidNext <= cursor.lastUid + 1) {
          setProgress(ownerId, {
            phase: 'scanning',
            scannedMessages: 0,
            totalMessages: 0,
            candidateMessages: 0,
            message: `Brak nowych wiadomości na ${cfg.user} od ostatniego skanowania.`,
          });
        } else {
          const seqStart = hasResume
            ? cursor!.resumeSeq!
            : (maxMessages === 'all' || isUnreadMode ? 1 : Math.max(1, total - Math.max(1, typeof maxMessages === 'number' ? maxMessages : 80) + 1));
          const expectedScan = isUnreadMode
            ? Math.max(1, unreadTotal || total)
            : (canUseCursor && uidNext > cursor.lastUid ? uidNext - cursor.lastUid - 1 : Math.max(1, total - seqStart + 1));
          let scannedCount = 0;
          let maxSeenUid = cursor?.lastUid || 0;
          const candidateUids: number[] = [];
          let processedCandidates = 0;
          const scanStartedAt = Date.now();
          let downloadStartedAt = 0;

          const scanChunkedFetch = async (
            wClient: ReturnType<typeof createImapClient>,
            range: string | number[],
            fetchOpts: { uid: true } | undefined,
            targetTotal: number,
            tickInterval: number,
            onlyUnread = false,
          ) => {
            for await (const meta of wClient.fetch(range, { uid: true, flags: onlyUnread, envelope: true, bodyStructure: true }, fetchOpts)) {
              if (stopRequestedSet.has(ownerId)) break;
              if (meta.uid > maxSeenUid) maxSeenUid = meta.uid;
              if (onlyUnread && meta.flags?.has('\\Seen')) continue;
              scannedCount++;
              const rawFrom = meta.envelope?.from?.[0]?.address || '';
              const fromEmail = rawFrom ? extractSenderEmail(rawFrom) : '';
              if (fromEmail && isSenderExcluded(fromEmail, excludedList)) continue;
              if (hasCandidateAttachment(meta.bodyStructure, { accountId: cfg.id, uid: meta.uid, seenKeys, existingTitles, attachmentKind })) {
                candidateUids.push(meta.uid);
                if (fromEmail) discoveredSenders.push(fromEmail);
              }
              if (scannedCount % tickInterval === 0 || scannedCount >= targetTotal) {
                const effTotal = Math.max(targetTotal, scannedCount);
                setProgress(ownerId, {
                  phase: 'scanning',
                  scannedMessages: scannedCount,
                  totalMessages: effTotal,
                  candidateMessages: candidateUids.length,
                  processedCandidates: 0,
                  addedAttachments: added,
                  etaSeconds: computeScanEta(scanStartedAt, scannedCount, effTotal),
                  message: `Szybkie liczenie załączników (${cfg.user}): ${scannedCount} / ${effTotal} · znaleziono: ${candidateUids.length}`,
                });
              }
            }
          };

          const downloadCandidateBatches = async (uids: number[]) => {
            const batches: number[][] = [];
            for (let i = 0; i < uids.length; i += 10) batches.push(uids.slice(i, i + 10));
            await runImapWorkerPool(ownerId, cfg, client, batches, 3, async (wClient, batch) => {
              const batchKeys: string[] = [];
              for await (const msg of wClient.fetch(batch, { uid: true, source: true }, { uid: true })) {
                if (stopRequestedSet.has(ownerId)) break;
                processedCandidates++;
                if (!msg.source) continue;
                const { addedCount, senderEmail, addedKeys } = await extractAndSaveMessageAttachments({
                  ownerId, accountId: cfg.id, uid: msg.uid, source: msg.source, folders,
                  existingTitles, seenKeys, excludedList, senderFolderRules, attachmentKind, onAutoAssign,
                });
                added += addedCount;
                if (addedKeys.length > 0) batchKeys.push(...addedKeys);
                if (senderEmail) discoveredSenders.push(senderEmail);
                setProgress(ownerId, {
                  phase: 'downloading',
                  processedCandidates,
                  candidateMessages: candidateUids.length,
                  addedAttachments: added,
                  etaSeconds: computeScanEta(downloadStartedAt, processedCandidates, candidateUids.length),
                  message: `Pobieranie równoległe (${cfg.user}): ${processedCandidates} / ${candidateUids.length} · dodano: ${added}`,
                });
              }
              if (discoveredSenders.length > 0) addKnownSenders(ownerId, discoveredSenders.splice(0, discoveredSenders.length));
              if (batchKeys.length > 0) markProcessedAttachmentKeys(ownerId, batchKeys.splice(0, batchKeys.length));
            });
          };

          setProgress(ownerId, {
            phase: 'scanning',
            scannedMessages: 0,
            totalMessages: Math.max(expectedScan, 1),
            candidateMessages: 0,
            processedCandidates: 0,
            message: canUseCursor
              ? `Skanowanie nowych wiadomości (${cfg.user} od UID ${cursor.lastUid + 1})…`
              : `Skanowanie skrzynki ${cfg.user}: 0 / ${expectedScan} wiadomości…`,
          });

          const unreadSeqStart = isUnreadMode && cursor?.unreadResumeSeq && cursor.unreadResumeSeq > 1 && cursor.unreadResumeSeq <= total && (!uidValidity || !cursor.uidValidity || cursor.uidValidity === uidValidity)
            ? cursor.unreadResumeSeq
            : seqStart;
          let seenSeqCount = 0;

          if (isUnreadMode) {
            const unreadExpected = Math.max(1, total - unreadSeqStart + 1);
            setProgress(ownerId, { totalMessages: unreadExpected, message: `Skanowanie równoległe nieodczytanych (${cfg.user}): od ${unreadSeqStart} / ${total}…` });
            const seqRanges: string[] = [];
            for (let s = unreadSeqStart; s <= total; s += 1000) seqRanges.push(`${s}:${Math.min(total, s + 999)}`);
            await runImapWorkerPool(ownerId, cfg, client, seqRanges, 3, (wClient, range) => scanChunkedFetch(wClient, range, undefined, unreadExpected, 50, true));
            seenSeqCount = total - unreadSeqStart + 1;
          } else if (canUseCursor) {
            const found = await client.search({ uid: `${cursor!.lastUid + 1}:*` }, { uid: true });
            const uids = (Array.isArray(found) ? found : []).filter(u => u > cursor!.lastUid);
            if (uids.length > 0) {
              setProgress(ownerId, { totalMessages: uids.length });
              const uidChunks: number[][] = [];
              for (let c = 0; c < uids.length; c += 100) uidChunks.push(uids.slice(c, c + 100));
              await runImapWorkerPool(ownerId, cfg, client, uidChunks, 3, (wClient, chunk) => scanChunkedFetch(wClient, chunk, { uid: true }, uids.length, 25, false));
            }
          } else {
            const seqRanges: string[] = [];
            for (let s = seqStart; s <= total; s += 1000) seqRanges.push(`${s}:${Math.min(total, s + 999)}`);
            await runImapWorkerPool(ownerId, cfg, client, seqRanges, 3, (wClient, range) => scanChunkedFetch(wClient, range, undefined, expectedScan, 50, false));
          }

          if (!stopRequestedSet.has(ownerId) && candidateUids.length > 0) {
            downloadStartedAt = Date.now();
            setProgress(ownerId, {
              phase: 'downloading',
              scannedMessages: scannedCount,
              totalMessages: Math.max(expectedScan, scannedCount),
              candidateMessages: candidateUids.length,
              processedCandidates: 0,
              etaSeconds: null,
              message: `Znaleziono ${candidateUids.length} maili z załącznikami — rozpoczynanie pobierania…`,
            });
            await downloadCandidateBatches(candidateUids);
          }

          if (isUnreadMode) {
            const nextUnreadSeq = unreadSeqStart + seenSeqCount;
            saveAccountSyncCursor(ownerId, cfg.id, uidValidity || cursor?.uidValidity || 0, cursor?.lastUid || 0, {
              unreadResumeSeq: stopRequestedSet.has(ownerId) && nextUnreadSeq <= total ? nextUnreadSeq : null,
            });
          } else if (stopRequestedSet.has(ownerId) && !canUseCursor && seqStart + scannedCount <= total) {
            saveAccountSyncCursor(ownerId, cfg.id, uidValidity, cursor?.lastUid || 0, { resumeSeq: seqStart + scannedCount, resumeLimit: String(maxMessages) });
          } else if (maxSeenUid > 0) {
            saveAccountSyncCursor(ownerId, cfg.id, uidValidity, maxSeenUid);
          }
          totalScannedForAccount = scannedCount;
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    if (!stopRequestedSet.has(ownerId)) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/connection not available|socket|econnreset|etimedout/i.test(msg)) {
        throw new Error(`Serwer poczty przerwał połączenie (${msg}). Postęp został zapisany — kliknij ponownie „Pobierz załączniki”, aby kontynuować.`);
      }
      throw err;
    }
  } finally {
    if (activeClients.get(ownerId) === client) activeClients.delete(ownerId);
    if (stopRequestedSet.has(ownerId)) try { client.close(); } catch { /* ignore */ }
    else await client.logout().catch(() => undefined);
  }
  return { added, scanned: totalScannedForAccount };
}

/** Connects via IMAP, downloads new PDF/image attachments into staging, and pre-assigns folders offline. */
export async function syncMailboxAttachments(
  prisma: PrismaClient,
  ownerId: number,
  options?: { accountId?: string; limit?: SyncLimit; attachmentKind?: AttachmentKind },
): Promise<{ added: number; scannedMessages?: number; stopped?: boolean; alreadyRunning?: boolean; items: MailInboxItem[] }> {
  if (activeSyncOwners.has(ownerId)) return { added: 0, alreadyRunning: true, items: listMailItems(ownerId) };
  const accounts = getMailAccounts(ownerId);
  if (accounts.length === 0) throw new Error('Najpierw skonfiguruj połączenie ze skrzynką pocztową (IMAP).');
  const targets = options?.accountId ? accounts.filter(a => a.id === options.accountId) : accounts;
  if (targets.length === 0) throw new Error('Nie znaleziono wskazanej skrzynki pocztowej.');

  activeSyncOwners.add(ownerId);
  try {
    const folders = await prisma.folder.findMany({ where: { ownerId }, select: { id: true, name: true, parentId: true } });
    const existingDocs = await prisma.document.findMany({ where: { userId: ownerId }, select: { title: true } });
    const existingTitles = new Set(existingDocs.flatMap(d => [d.title.trim().toLowerCase(), path.parse(d.title.trim().toLowerCase()).name]));
    const filters = getMailFilters(ownerId);
    const seenKeys = new Set([
      ...listMailItems(ownerId).map(i => `${i.uid}:${i.filename.toLowerCase()}`),
      ...(filters.processedKeys || []),
    ]);
    const onAutoAssign = await buildMailAutoAssigner(prisma, ownerId);
    const discoveredSenders: string[] = [];
    const maxMessages: SyncLimit = options?.limit === 'all' || options?.limit === 'incremental' || options?.limit === 'unread'
      ? options.limit
      : Math.max(1, Number(options?.limit || 80));

    let added = 0;
    let scannedMessages = 0;
    stopRequestedSet.delete(ownerId);
    setProgress(ownerId, {
      active: true, phase: 'connecting', accountUser: targets[0].user,
      scannedMessages: 0, totalMessages: 0, candidateMessages: 0, processedCandidates: 0, addedAttachments: 0,
      message: 'Rozpoczynanie skanowania poczty…',
    });

    for (const cfg of targets) {
      if (stopRequestedSet.has(ownerId)) break;
      const res = await syncSingleAccount(
        cfg, ownerId, folders, existingTitles, seenKeys, filters.excludedSenders,
        discoveredSenders, maxMessages, filters.senderFolderRules || {}, onAutoAssign, options?.attachmentKind || 'documents',
      );
      added += res.added;
      scannedMessages += res.scanned;
      setProgress(ownerId, { addedAttachments: added });
    }
    addKnownSenders(ownerId, discoveredSenders);
    const wasStopped = stopRequestedSet.has(ownerId);
    stopRequestedSet.delete(ownerId);
    setProgress(ownerId, {
      active: false, phase: wasStopped ? 'paused' : 'done', addedAttachments: added,
      message: wasStopped
        ? `Wstrzymano skanowanie. Pobrano dotąd: ${added} załączników (możesz wznowić).`
        : `Zakończono. Przeskanowano: ${scannedMessages} · nowych załączników: ${added}.`,
    });
    return { added, scannedMessages, stopped: wasStopped, items: listMailItems(ownerId) };
  } catch (err) {
    stopRequestedSet.delete(ownerId);
    setProgress(ownerId, { active: false, phase: 'error', message: err instanceof Error ? err.message : 'Błąd synchronizacji poczty.' });
    throw err;
  } finally {
    activeSyncOwners.delete(ownerId);
  }
}
