import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

type Args = {
  apiUrl: string;
  fetcher: typeof fetch;
  showToast: (message: string, type?: string) => void;
  onSyncCompleted?: (added: number, totalItems: number) => void;
};

const CONNECTING_PLACEHOLDER: MailSyncProgress = {
  active: true,
  phase: 'connecting',
  accountUser: '',
  scannedMessages: 0,
  totalMessages: 0,
  candidateMessages: 0,
  processedCandidates: 0,
  addedAttachments: 0,
  message: 'Łączenie z serwerem poczty…',
};

/** Polls live mailbox scan/download progress locally inside the component that renders it (prevents full-app flicker). */
export function useMailSyncProgress(apiUrl: string, fetcher: typeof fetch, active: boolean): MailSyncProgress | null {
  const [progress, setProgress] = useState<MailSyncProgress | null>(null);

  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }
    setProgress(prev => prev || CONNECTING_PLACEHOLDER);
    let mounted = true;
    const poll = () => {
      void fetcher(`${apiUrl}/api/mail-inbox/sync/progress`)
        .then(async r => (r.ok ? r.json() as Promise<MailSyncProgress> : null))
        .then(p => {
          if (!mounted || !p) return;
          if (p.active) setProgress(p);
        })
        .catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 550);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [apiUrl, fetcher, active]);

  return progress;
}

/** Keeps mailbox sync execution alive at app level across view navigation without re-rendering the whole app on progress ticks. */
export function useMailSync({ apiUrl, fetcher, showToast, onSyncCompleted }: Args) {
  const [mailSyncing, setMailSyncing] = useState(false);
  const [mailSyncPaused, setMailSyncPaused] = useState(false);
  const completedCbRef = useRef(onSyncCompleted);
  completedCbRef.current = onSyncCompleted;

  useEffect(() => {
    let mounted = true;
    void fetcher(`${apiUrl}/api/mail-inbox/sync/progress`)
      .then(async r => (r.ok ? r.json() as Promise<MailSyncProgress> : null))
      .then(p => {
        if (!mounted || !p) return;
        if (p.active) setMailSyncing(true);
        else if (p.phase === 'paused') setMailSyncPaused(true);
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, [apiUrl, fetcher]);

  const startMailSync = useCallback(async (
    accountId?: string,
    limit: string | number = 'incremental',
    attachmentKind: 'all' | 'documents' | 'images' = 'documents',
  ) => {
    setMailSyncing(true);
    setMailSyncPaused(false);
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, limit, attachmentKind }),
      });
      const data = await res.json() as { added?: number; scannedMessages?: number; stopped?: boolean; items?: unknown[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Nie udało się pobrać załączników.');
      const added = Number(data.added || 0);
      const scanned = Number(data.scannedMessages || 0);
      const totalItems = Array.isArray(data.items) ? data.items.length : 0;
      if (data.stopped) {
        setMailSyncPaused(true);
        showToast(`Wstrzymano skanowanie (pobrano: ${added}). Możesz wznowić od ostatniego miejsca.`, 'success');
      } else {
        completedCbRef.current?.(added, totalItems);
        showToast(
          added
            ? `Pobrano nowych załączników: ${added} (przeskanowano wiadomości: ${scanned}).`
            : (scanned > 0
              ? `Przeskanowano ${scanned} wiadomości — wszystkie znalezione załączniki (${totalItems}) są już pobrane w poczekalni lub w kartotekach.`
              : (limit === 'incremental'
                ? 'Brak nowych maili od ostatniego skanu. Aby przeszukać starsze wiadomości, wybierz „Cała skrzynka”.'
                : 'Brak wiadomości do przeskanowania w wybranym zakresie.')),
          'success',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd synchronizacji poczty.', 'error');
    } finally {
      setMailSyncing(false);
    }
  }, [apiUrl, fetcher, showToast]);

  const stopMailSync = useCallback(async () => {
    try {
      await fetcher(`${apiUrl}/api/mail-inbox/sync/stop`, { method: 'POST' });
      showToast('Zatrzymywanie skanowania poczty…', 'success');
    } catch { /* ignore */ }
  }, [apiUrl, fetcher, showToast]);

  const resetMailSync = useCallback(async (accountId?: string) => {
    try {
      await fetcher(`${apiUrl}/api/mail-inbox/sync/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      setMailSyncPaused(false);
      setMailSyncing(false);
      showToast('Zresetowano postęp skanowania poczty.', 'success');
    } catch {
      showToast('Nie udało się zresetować skanowania.', 'error');
    }
  }, [apiUrl, fetcher, showToast]);

  return useMemo(
    () => ({ mailSyncing, mailSyncPaused, startMailSync, stopMailSync, resetMailSync }),
    [mailSyncing, mailSyncPaused, startMailSync, stopMailSync, resetMailSync],
  );
}
