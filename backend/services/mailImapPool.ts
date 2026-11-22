import type { MailAccountConfig } from './mailInboxStore';
import { createImapClient, stopRequestedSet } from './mailSyncProgress';

/** Computes remaining seconds ETA from elapsed time and processed item count. */
export function computeScanEta(startedAt: number, done: number, totalItems: number): number | null {
  if (!startedAt || done < 5 || totalItems <= done) return null;
  const elapsedSec = (Date.now() - startedAt) / 1000;
  if (elapsedSec < 1) return null;
  return Math.max(1, Math.round((totalItems - done) / (done / elapsedSec)));
}

/** Runs queued IMAP tasks across up to `maxWorkers` concurrent connections, reusing `primaryClient` for worker 0. */
export async function runImapWorkerPool<T>(
  ownerId: number,
  cfg: MailAccountConfig,
  primaryClient: ReturnType<typeof createImapClient>,
  items: T[],
  maxWorkers: number,
  workerFn: (workerClient: ReturnType<typeof createImapClient>, item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const count = Math.min(maxWorkers, queue.length);
  if (count <= 1) {
    for (const item of queue) {
      if (stopRequestedSet.has(ownerId)) break;
      await workerFn(primaryClient, item);
    }
    return;
  }

  const runSingleWorker = async (usePrimary: boolean) => {
    const wClient = usePrimary ? primaryClient : createImapClient(cfg);
    let wLock: { release: () => void } | null = null;
    try {
      if (!usePrimary) {
        await wClient.connect();
        wLock = await wClient.getMailboxLock(cfg.mailbox || 'INBOX');
      }
      while (!stopRequestedSet.has(ownerId)) {
        const next = queue.shift();
        if (next === undefined) break;
        await workerFn(wClient, next);
      }
    } finally {
      if (wLock) try { wLock.release(); } catch { /* ignore */ }
      if (!usePrimary) await wClient.logout().catch(() => undefined);
    }
  };

  await Promise.all(Array.from({ length: count }, (_, idx) => runSingleWorker(idx === 0)));
}
