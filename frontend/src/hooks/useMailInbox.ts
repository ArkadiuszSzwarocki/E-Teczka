import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailAccountFormValues, MailAccountPublic, MailboxStats, MailItem, SenderFilterEntry } from '../types/mailInbox';

type UseMailInboxArgs = {
  apiUrl: string;
  fetcher: typeof fetch;
  syncing: boolean;
  billingPlan?: string;
  onAssigned: () => Promise<void>;
  onResetSync: (accountId?: string) => Promise<void>;
  showToast: (message: string, type?: string) => void;
};

/** Manages mail inbox accounts, pending attachments, sender exclusions, watch folder, and live sync refresh. */
export function useMailInbox({ apiUrl, fetcher, syncing, billingPlan, onAssigned, onResetSync, showToast }: UseMailInboxArgs) {
  const [items, setItems] = useState<MailItem[]>([]);
  const [accounts, setAccounts] = useState<MailAccountPublic[]>([]);
  const [canAddMultiple, setCanAddMultiple] = useState(false);
  const [canAssign, setCanAssign] = useState(true);
  const [senders, setSenders] = useState<SenderFilterEntry[]>([]);
  const [watchPath, setWatchPath] = useState('');
  const [watchAllowed, setWatchAllowed] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [previewItem, setPreviewItem] = useState<{ item: MailItem; url: string } | null>(null);
  const [needsInitialConfig, setNeedsInitialConfig] = useState(false);
  const [stats, setStats] = useState<MailboxStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accRes, itemsRes, watchRes, sendersRes] = await Promise.all([
        fetcher(`${apiUrl}/api/mail-inbox/accounts`),
        fetcher(`${apiUrl}/api/mail-inbox/items`),
        fetcher(`${apiUrl}/api/automation/watch-folder`),
        fetcher(`${apiUrl}/api/mail-inbox/senders`),
      ]);
      if (sendersRes.ok) setSenders(await sendersRes.json() as SenderFilterEntry[]);
      if (watchRes.ok) {
        const w = await watchRes.json() as { folderPath?: string; allowed?: boolean };
        setWatchPath(w.folderPath || '');
        setWatchAllowed(Boolean(w.allowed));
      }
      if (accRes.ok) {
        const accData = await accRes.json() as { accounts: MailAccountPublic[]; canAddMultiple: boolean; canAssign?: boolean };
        setAccounts(accData.accounts || []);
        setCanAddMultiple(Boolean(accData.canAddMultiple));
        setCanAssign(accData.canAssign !== false);
        setNeedsInitialConfig(!accData.accounts?.length);
      }
      if (itemsRes.ok) setItems(await itemsRes.json() as MailItem[]);
    } catch { /* ignore */ }
  }, [apiUrl, fetcher]);

  useEffect(() => { void load(); }, [load, billingPlan]);

  const wasSyncingRef = useRef(syncing);
  useEffect(() => {
    if (wasSyncingRef.current && !syncing) void load();
    wasSyncingRef.current = syncing;
  }, [syncing, load]);

  useEffect(() => {
    if (!syncing) return;
    const refreshLive = () => {
      void Promise.all([
        fetcher(`${apiUrl}/api/mail-inbox/items`).then(async r => (r.ok ? r.json() as Promise<MailItem[]> : null)),
        fetcher(`${apiUrl}/api/mail-inbox/senders`).then(async r => (r.ok ? r.json() as Promise<SenderFilterEntry[]> : null)),
      ]).then(([nextItems, nextSenders]) => {
        if (nextItems) setItems(nextItems);
        if (nextSenders) setSenders(nextSenders);
      }).catch(() => undefined);
    };
    const timer = window.setInterval(refreshLive, 2000);
    return () => window.clearInterval(timer);
  }, [syncing, apiUrl, fetcher]);

  const saveAccountConfig = async (payload: MailAccountFormValues): Promise<boolean> => {
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { accounts?: MailAccountPublic[]; canAddMultiple?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || 'Błąd zapisu konfiguracji.');
      if (Array.isArray(data.accounts)) setAccounts(data.accounts);
      if (typeof data.canAddMultiple === 'boolean') setCanAddMultiple(data.canAddMultiple);
      showToast('Zapisano skrzynkę pocztową.', 'success');
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd konfiguracji IMAP.', 'error');
      return false;
    }
  };

  const removeAccount = async (id: string) => {
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/accounts/${id}`, { method: 'DELETE' });
      const data = await res.json() as { accounts?: MailAccountPublic[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Nie udało się usunąć skrzynki.');
      if (Array.isArray(data.accounts)) setAccounts(data.accounts);
      await onResetSync(id);
      showToast('Usunięto skrzynkę pocztową i zatrzymano skanowanie.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd usuwania skrzynki.', 'error');
    }
  };

  const assignToFolder = async (itemId: string, folderId: number) => {
    setBusyId(itemId);
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/items/${itemId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Nie udało się przypisać załącznika.');
      setItems(prev => prev.filter(i => i.id !== itemId));
      await onAssigned();
      showToast('Załącznik przeniesiony do kartoteki (wybór zapamiętany).', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd przenoszenia.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const assignItemsBulk = async (
    target: string[] | Array<{ id: string; folderId: number }>,
    folderId?: number,
  ) => {
    if (target.length === 0) return;
    setBusyId('bulk');
    const total = target.length;
    const BATCH_SIZE = 10;
    let totalMoved = 0;
    let totalDuplicates = 0;
    setBulkProgress({ current: 0, total, label: 'Przenoszenie załączników do kartotek…' });
    try {
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const chunk = target.slice(i, i + BATCH_SIZE);
        const payload = typeof chunk[0] === 'string' ? { ids: chunk, folderId } : { items: chunk };
        const res = await fetcher(`${apiUrl}/api/mail-inbox/items/bulk-assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await parseJsonOrThrow<{ movedCount?: number; skippedDuplicates?: number; items?: MailItem[]; error?: string }>(res, '/items/bulk-assign');
        if (Array.isArray(data.items)) setItems(data.items);
        totalMoved += Number(data.movedCount || 0);
        totalDuplicates += Number(data.skippedDuplicates || 0);
        setBulkProgress({ current: Math.min(total, i + chunk.length), total, label: 'Przenoszenie załączników do kartotek…' });
        if (!res.ok) throw new Error(data.error || 'Nie udało się hurtowo przenieść załączników.');
      }
      if (totalMoved > 0) await onAssigned();
      showToast(`Przeniesiono do kartoteki: ${totalMoved} załączników${totalDuplicates ? ` (pominięto duplikatów: ${totalDuplicates})` : ''}.`, 'success');
    } catch (err) {
      if (totalMoved > 0) await onAssigned();
      showToast(err instanceof Error ? err.message : 'Błąd hurtowego przenoszenia.', 'error');
    } finally {
      setBulkProgress(null);
      setBusyId(null);
    }
  };

  const discardItem = async (itemId: string) => {
    setBusyId(itemId);
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/items/${itemId}`, { method: 'DELETE' });
      if (res.ok) setItems(prev => prev.filter(i => i.id !== itemId));
    } finally {
      setBusyId(null);
    }
  };

  const discardItemsBulk = async (itemIds: string[], block = true) => {
    if (itemIds.length === 0) return;
    setBusyId('bulk');
    const total = itemIds.length;
    const BATCH_SIZE = 50;
    let totalRemoved = 0;
    const label = block ? 'Usuwanie i blokowanie zaznaczonych załączników…' : 'Odrzucanie zaznaczonych załączników…';
    setBulkProgress({ current: 0, total, label });
    try {
      for (let i = 0; i < total; i += BATCH_SIZE) {
        const chunk = itemIds.slice(i, i + BATCH_SIZE);
        const res = await fetcher(`${apiUrl}/api/mail-inbox/items/bulk-discard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk, block }),
        });
        const data = await parseJsonOrThrow<{ removed?: number; items?: MailItem[]; error?: string }>(res, '/items/bulk-discard');
        if (!res.ok) throw new Error(data.error || 'Nie udało się usunąć zaznaczonych załączników.');
        if (Array.isArray(data.items)) setItems(data.items);
        totalRemoved += Number(data.removed || 0);
        setBulkProgress({ current: Math.min(total, i + chunk.length), total, label });
      }
      showToast(
        block
          ? `Usunięto i zablokowano ponowne pobieranie: ${totalRemoved} załączników.`
          : `Odrzucono grupowo: ${totalRemoved} załączników.`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd usuwania załączników.', 'error');
    } finally {
      setBulkProgress(null);
      setBusyId(null);
    }
  };

  const openPreview = async (item: MailItem) => {
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/items/${item.id}/file`);
      if (!res.ok) throw new Error('Nie udało się pobrać podglądu załącznika.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewItem(prev => { if (prev) URL.revokeObjectURL(prev.url); return { item, url }; });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd podglądu.', 'error');
    }
  };

  const closePreview = () => {
    setPreviewItem(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  };

  const saveAndScanWatchFolder = async (scanAfter: boolean) => {
    setWatchBusy(true);
    try {
      const saveRes = await fetcher(`${apiUrl}/api/automation/watch-folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: watchPath, enabled: Boolean(watchPath.trim()) }),
      });
      const saveData = await saveRes.json() as { error?: string };
      if (!saveRes.ok) throw new Error(saveData.error || 'Błąd zapisu folderu obserwowanego.');
      if (scanAfter) {
        const scanRes = await fetcher(`${apiUrl}/api/automation/watch-folder/scan`, { method: 'POST' });
        const scanData = await scanRes.json() as { added?: number; items?: MailItem[]; error?: string };
        if (!scanRes.ok) throw new Error(scanData.error || 'Błąd skanowania folderu obserwowanego.');
        if (Array.isArray(scanData.items)) setItems(scanData.items);
        showToast(scanData.added ? `Dodano z folderu obserwowanego: ${scanData.added}` : 'Brak nowych plików w folderze obserwowanym.', 'success');
      } else {
        showToast('Zapisano ścieżkę folderu obserwowanego.', 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd folderu obserwowanego.', 'error');
    } finally {
      setWatchBusy(false);
    }
  };

  const uploadWatchFolderFiles = async (files: File[], folderName: string) => {
    const supported = files.filter(f => /\.(pdf|png|jpe?g|xml|json)$/i.test(f.name) && f.size > 0).slice(0, 30);
    if (!supported.length) {
      showToast('Wybrany folder nie zawiera plików PDF, PNG, JPG, KSeF XML ani e-Paragonów JSON.', 'error');
      return;
    }
    setWatchBusy(true);
    try {
      const form = new FormData();
      form.append('folderName', folderName);
      for (const file of supported) form.append('files', file);
      const res = await fetcher(`${apiUrl}/api/automation/watch-folder/upload`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json() as { added?: number; items?: MailItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Nie udało się przeskanować folderu z telefonu.');
      if (Array.isArray(data.items)) setItems(data.items);
      showToast(data.added ? `Dodano z folderu telefonu do poczekalni: ${data.added}` : 'Brak nowych plików do dodania.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd przesyłania plików z folderu.', 'error');
    } finally {
      setWatchBusy(false);
    }
  };

  const parseJsonOrThrow = async <T,>(res: Response, endpointLabel: string): Promise<T> => {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Brak endpointu ${endpointLabel} w uruchomionym backendzie — zrestartuj serwer backendu / aplikację.`);
    }
    return res.json() as Promise<T>;
  };

  const toggleSenderExclusion = async (email: string, excluded: boolean) => {
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/senders/exclusion`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, excluded }),
      });
      const data = await parseJsonOrThrow<{ senders?: SenderFilterEntry[]; items?: MailItem[]; error?: string }>(res, '/senders/exclusion');
      if (!res.ok) throw new Error(data.error || 'Nie udało się zaktualizować nadawcy.');
      if (Array.isArray(data.senders)) setSenders(data.senders);
      if (Array.isArray(data.items)) setItems(data.items);
      showToast(excluded ? `Wykluczono nadawcę: ${email}` : `Przywrócono nadawcę: ${email}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd filtra nadawców.', 'error');
    }
  };

  const assignSenderFolder = async (email: string, folderId: number | null) => {
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/senders/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, folderId }),
      });
      const data = await parseJsonOrThrow<{ senders?: SenderFilterEntry[]; items?: MailItem[]; movedCount?: number; error?: string }>(res, '/senders/folder');
      if (!res.ok) throw new Error(data.error || 'Nie udało się zapisać reguły kartoteki.');
      if (Array.isArray(data.senders)) setSenders(data.senders);
      if (Array.isArray(data.items)) setItems(data.items);
      const moved = Number(data.movedCount || 0);
      if (moved > 0) await onAssigned();
      if (folderId) {
        showToast(
          moved > 0
            ? `Przeniesiono ${moved} istniejących załączników od ${email} do kartoteki — kolejne również trafią tam automatycznie.`
            : `Załączniki od ${email} będą trafiać automatycznie do wybranej kartoteki.`,
          'success',
        );
      } else {
        showToast(`Usunięto regułę automatycznej kartoteki dla: ${email}`, 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd reguły nadawcy.', 'error');
    }
  };

  const checkMailboxStats = async (accountId?: string) => {
    setStatsLoading(true);
    try {
      const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
      const res = await fetcher(`${apiUrl}/api/mail-inbox/stats${qs}`);
      const data = await parseJsonOrThrow<MailboxStats & { error?: string }>(res, '/stats');
      if (!res.ok) throw new Error(data.error || 'Nie udało się sprawdzić skrzynki.');
      setStats(data);
      showToast(`W skrzynce: ${data.totalMessages} maili · Nieodczytane: ${data.unreadMessages}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Błąd sprawdzania skrzynki.', 'error');
    } finally {
      setStatsLoading(false);
    }
  };

  return {
    items, accounts, canAddMultiple, canAssign, senders,
    watchPath, setWatchPath, watchAllowed, watchBusy,
    busyId, bulkProgress, previewItem, needsInitialConfig, stats, statsLoading,
    saveAccountConfig, removeAccount, assignToFolder, assignItemsBulk, discardItem, discardItemsBulk,
    openPreview, closePreview, saveAndScanWatchFolder, uploadWatchFolderFiles, toggleSenderExclusion,
    assignSenderFolder, checkMailboxStats,
  };
}
