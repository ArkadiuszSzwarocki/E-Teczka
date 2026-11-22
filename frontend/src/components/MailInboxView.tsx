import { useEffect, useState } from 'react';
import type { FolderRecord } from '../types/domain';
import type { MailAccountFormValues, MailAccountPublic } from '../types/mailInbox';
import { getAutoMailSyncEnabled, setAutoMailSyncEnabled } from '../services/sensitiveMasking';
import { useMailSyncProgress } from '../hooks/useMailSync';
import { useMailInbox } from '../hooks/useMailInbox';
import { MailAccountForm } from './mail/MailAccountForm';
import { MailPendingList } from './mail/MailPendingList';
import { MailPreviewModal } from './mail/MailPreviewModal';
import { MailSendersPanel } from './mail/MailSendersPanel';
import { MailSyncProgressPanel } from './mail/MailSyncProgressPanel';
import { MailToolsSideDrawer, type MailToolTab } from './mail/MailToolsSideDrawer';
import { MailWatchFolderPanel } from './mail/MailWatchFolderPanel';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  folders: FolderRecord[];
  billingPlan?: string;
  onAssigned: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
  mailSyncing: boolean;
  mailSyncPaused: boolean;
  onStartSync: (accountId?: string, limit?: string | number, attachmentKind?: 'all' | 'documents' | 'images') => Promise<void>;
  onStopSync: () => Promise<void>;
  onResetSync: (accountId?: string) => Promise<void>;
};

/** Mail attachments staging view: orchestrates mailbox sync, sender filtering, preview, and folder assignment. */
export default function MailInboxView({
  apiUrl, fetcher, folders, billingPlan, onAssigned, showToast,
  mailSyncing: syncing, mailSyncPaused, onStartSync, onStopSync, onResetSync,
}: Props) {
  const syncProgress = useMailSyncProgress(apiUrl, fetcher, syncing);
  const inbox = useMailInbox({ apiUrl, fetcher, syncing, billingPlan, onAssigned, onResetSync, showToast });
  const [autoMailSync, setAutoMailSync] = useState(getAutoMailSyncEnabled);
  const [syncMode, setSyncMode] = useState<'incremental' | 'unread' | 'custom' | 'all'>('incremental');
  const [attachmentKind, setAttachmentKind] = useState<'documents' | 'images' | 'all'>('documents');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [customCount, setCustomCount] = useState('100');
  const [configOpen, setConfigOpen] = useState(false);
  const [activeToolPanel, setActiveToolPanel] = useState<MailToolTab | null>(null);
  const [editingAccount, setEditingAccount] = useState<MailAccountPublic | null>(null);

  const watchIds = inbox.items
    .filter(i => i.from === 'Folder obserwowany' || i.from === 'Gorący folder')
    .map(i => i.id);
  const activeSendersCount = inbox.senders.filter(s => !s.excluded).length;

  useEffect(() => {
    if (inbox.needsInitialConfig) setConfigOpen(true);
  }, [inbox.needsInitialConfig]);

  useEffect(() => {
    if (selectedAccountId && !inbox.accounts.some(a => a.id === selectedAccountId)) {
      setSelectedAccountId('');
    }
  }, [inbox.accounts, selectedAccountId]);

  const activeAccountId = selectedAccountId || undefined;

  const syncNow = async (accountId?: string) => {
    const limitVal = syncMode === 'custom' ? Math.max(1, Number(customCount) || 100) : syncMode;
    await onStartSync(accountId ?? activeAccountId, limitVal, attachmentKind);
  };

  const handleSaveAccount = async (values: MailAccountFormValues) => {
    const ok = await inbox.saveAccountConfig(values);
    if (ok) {
      setConfigOpen(false);
      setEditingAccount(null);
    }
  };

  const handleTestAccount = async (values: Partial<MailAccountFormValues> & { id?: string }): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetcher(`${apiUrl}/api/mail-inbox/accounts/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json() as { ok?: boolean; mailbox?: string; totalMessages?: number; unreadMessages?: number; error?: string };
      if (!res.ok || !data.ok) {
        return { ok: false, message: data.error || 'Nie udało się połączyć ze skrzynką IMAP.' };
      }
      return {
        ok: true,
        message: `Połączenie i logowanie poprawne! Folder „${data.mailbox || 'INBOX'}” dostępny (wiadomości: ${data.totalMessages ?? 0}, nieprzeczytanych: ${data.unreadMessages ?? 0}).`,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Błąd podczas testowania połączenia.' };
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">📧 Poczta — Załączniki do segregacji</h2>
          <p className="text-sm text-slate-400">System wstępnie rozpoznaje załączniki i proponuje kartotekę. Potwierdź jednym kliknięciem albo przeciągnij (Drag & Drop) na wybrany katalog.</p>
        </div>
        {inbox.accounts.length === 0 && (
          <button type="button" onClick={() => { setEditingAccount(null); setConfigOpen(v => !v); }} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            ⚙️ Skonfiguruj IMAP
          </button>
        )}
      </div>

      {!inbox.canAssign && (
        <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          Plan <strong>Darmowy</strong> umożliwia skanowanie i podgląd załączników z poczty. Przenoszenie załączników do kartotek (Zatwierdź / Drag & Drop) jest zablokowane — przejdź na plan <strong>Standard</strong> lub <strong>Premium</strong>, aby przenosić je bezpośrednio do folderów.
        </div>
      )}

      <MailToolsSideDrawer
        activeTab={activeToolPanel}
        onSelectTab={setActiveToolPanel}
        syncing={syncing}
        accountsCount={inbox.accounts.length}
        sendersCount={activeSendersCount}
        watchCount={watchIds.length}
        watchActive={Boolean(inbox.watchPath)}
      >
        {activeToolPanel === 'sync' && (
          <section className="space-y-3 rounded-xl border border-slate-700 bg-[#1e293b] p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">🔄 Pobieranie załączników z poczty</h3>
            <div className="space-y-2.5">
              {inbox.accounts.length > 1 && (
                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  aria-label="Wybierz skrzynkę pocztową"
                  title="Wybierz z której skrzynki pobierać załączniki"
                  className="w-full rounded-lg border border-cyan-500/40 bg-[#0f172a] px-3 py-2 text-xs text-cyan-100"
                >
                  <option value="">📬 Wszystkie skrzynki ({inbox.accounts.length})</option>
                  {inbox.accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>📬 {acc.user}</option>
                  ))}
                </select>
              )}
              <select
                value={syncMode}
                onChange={e => setSyncMode(e.target.value as 'incremental' | 'unread' | 'custom' | 'all')}
                className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-xs text-slate-200"
              >
                <option value="incremental">Tylko nowe (od ostatniego skanu)</option>
                <option value="unread">
                  {inbox.stats ? `Nieprzeczytane w poczcie (${inbox.stats.unreadMessages})` : 'Nieprzeczytane w poczcie'}
                </option>
                <option value="custom">Ostatnie (własna ilość)</option>
                <option value="all">
                  {inbox.stats ? `Cała skrzynka (${inbox.stats.totalMessages})` : 'Cała skrzynka (pełny skan)'}
                </option>
              </select>
              {syncMode === 'custom' && (
                <input
                  type="number"
                  min={1}
                  value={customCount}
                  onChange={e => setCustomCount(e.target.value)}
                  placeholder="Ilość"
                  aria-label="Liczba ostatnich wiadomości do przeskanowania"
                  className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-xs text-white"
                />
              )}
              <select
                value={attachmentKind}
                onChange={e => setAttachmentKind(e.target.value as 'documents' | 'images' | 'all')}
                aria-label="Typ pobieranych załączników"
                title="Wybierz czy pobierać tylko dokumenty (PDF), tylko zdjęcia/grafiki, czy wszystko"
                className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-xs text-slate-200"
              >
                <option value="documents">📄 Tylko dokumenty</option>
                <option value="images">🖼️ Tylko zdjęcia</option>
                <option value="all">📄+🖼️ Dokumenty i zdjęcia</option>
              </select>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {syncing ? (
                  <button type="button" onClick={() => void onStopSync()} className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500">⏸ Zatrzymaj</button>
                ) : mailSyncPaused ? (
                  <button type="button" disabled={inbox.accounts.length === 0} onClick={() => void syncNow()} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">▶ Wznów skanowanie</button>
                ) : (
                  <button type="button" disabled={inbox.accounts.length === 0} onClick={() => void syncNow()} className="flex-1 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50">🔄 Pobierz załączniki</button>
                )}
                <button
                  type="button"
                  disabled={inbox.accounts.length === 0 || inbox.statsLoading || syncing}
                  onClick={() => void inbox.checkMailboxStats(activeAccountId)}
                  title="Sprawdź ile jest wszystkich i nieodczytanych wiadomości na serwerze"
                  className="rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-40"
                >
                  {inbox.statsLoading ? 'Sprawdzanie…' : '📊 Sprawdź ile maili'}
                </button>
                <button
                  type="button"
                  disabled={inbox.accounts.length === 0}
                  onClick={() => { setSyncMode('all'); void onResetSync(activeAccountId); }}
                  title="Wyczyść zapisany postęp i ustaw pełny skan całej skrzynki"
                  className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                >
                  ↺ Resetuj
                </button>
              </div>
            </div>

            {inbox.stats && (
              <div role="status" className="space-y-1 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3 text-xs text-cyan-100">
                <p>📬 Wszystkie: <strong>{inbox.stats.totalMessages}</strong></p>
                <p>✅ Już sprawdzone przez MojąTeczkę: <strong>{inbox.stats.checkedMessages}</strong></p>
                <p>🆕 Nowe (niesprawdzone): <strong>{inbox.stats.newMessages}</strong></p>
                <p>✉️ Nieprzeczytane w poczcie: <strong>{inbox.stats.unreadMessages}</strong> <span className="text-slate-400">(bez oznaczania jako przeczytane)</span></p>
              </div>
            )}
          </section>
        )}
        {activeToolPanel === 'accounts' && (
          <section className="space-y-3 rounded-xl border border-slate-700 bg-[#1e293b] p-4">
            {inbox.accounts.length === 0 ? (
              <p className="text-xs text-slate-400">Brak skonfigurowanych skrzynek. Kliknij „Skonfiguruj IMAP”, aby dodać pierwszą skrzynkę.</p>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-col gap-2">
                  {inbox.accounts.map(acc => (
                    <div
                      key={acc.id}
                      onClick={() => { if (inbox.accounts.length > 1) setSelectedAccountId(prev => (prev === acc.id ? '' : acc.id)); }}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                        selectedAccountId === acc.id
                          ? 'border-cyan-400 bg-cyan-950/40 text-cyan-100'
                          : 'border-slate-700 bg-[#0f172a]/70 text-slate-200'
                      } ${inbox.accounts.length > 1 ? 'cursor-pointer hover:border-cyan-500/60' : ''}`}
                    >
                      <span className="min-w-0 truncate">📬 {acc.user} <span className="text-slate-400">({acc.mailbox})</span></span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            void handleTestAccount({ id: acc.id }).then(r => showToast(r.message, r.ok ? 'success' : 'error'));
                          }}
                          className="text-emerald-300 hover:text-emerald-200"
                          title="Testuj połączenie z tą skrzynką"
                        >
                          🔌
                        </button>
                        <button type="button" disabled={syncing} onClick={e => { e.stopPropagation(); void syncNow(acc.id); }} className="text-cyan-300 hover:text-cyan-200" title="Pobierz tylko z tej skrzynki">🔄</button>
                        <button type="button" onClick={e => { e.stopPropagation(); setEditingAccount(acc); setConfigOpen(true); setActiveToolPanel(null); }} className="text-slate-400 hover:text-white" title="Edytuj">✏️</button>
                        <button type="button" onClick={e => { e.stopPropagation(); void inbox.removeAccount(acc.id); }} className="text-red-400 hover:text-red-300" title="Usuń skrzynkę">×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-[#0f172a]/70 px-3 py-2 text-xs text-slate-200">
                  <input type="checkbox" checked={autoMailSync} onChange={e => { setAutoMailSync(e.target.checked); setAutoMailSyncEnabled(e.target.checked); }} className="h-3.5 w-3.5 accent-cyan-500" />
                  <span>Skanuj automatycznie przy wejściu do MojejTeczki</span>
                </label>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!inbox.canAddMultiple}
                    onClick={() => { setEditingAccount(null); setConfigOpen(true); setActiveToolPanel(null); }}
                    title={!inbox.canAddMultiple ? 'Wiele skrzynek pocztowych dostępnych od pakietu Premium.' : 'Dodaj kolejną skrzynkę IMAP'}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    ＋ Dodaj kolejną skrzynkę
                  </button>
                  {!inbox.canAddMultiple && (
                    <span className="text-[11px] text-amber-300/90">Wiele skrzynek od Premium</span>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {activeToolPanel === 'senders' && (
          <MailSendersPanel
            senders={inbox.senders}
            folders={folders}
            canAssign={inbox.canAssign}
            defaultExpanded
            onToggleExclusion={inbox.toggleSenderExclusion}
            onAssignFolder={inbox.assignSenderFolder}
          />
        )}

        {activeToolPanel === 'watch' && (
          <MailWatchFolderPanel
            watchPath={inbox.watchPath}
            watchAllowed={inbox.watchAllowed}
            watchBusy={inbox.watchBusy}
            pendingCount={watchIds.length}
            onPathChange={inbox.setWatchPath}
            onSaveOrScan={inbox.saveAndScanWatchFolder}
            onUploadMobileFiles={inbox.uploadWatchFolderFiles}
            onDiscardPending={() => inbox.discardItemsBulk(watchIds)}
          />
        )}
      </MailToolsSideDrawer>

      {!syncing && mailSyncPaused && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-100">
          <span>⏸ Skanowanie poczty zostało wstrzymane. Możesz wznowić od ostatniego miejsca albo zresetować postęp.</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void syncNow()} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500">▶ Wznów skanowanie</button>
            <button type="button" onClick={() => { setSyncMode('all'); void onResetSync(); }} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 font-semibold text-slate-200 hover:bg-slate-700">↺ Resetuj</button>
          </div>
        </div>
      )}

      {syncing && syncProgress && <MailSyncProgressPanel progress={syncProgress} />}
      {configOpen && <MailAccountForm editingAccount={editingAccount} onSubmit={handleSaveAccount} onTest={handleTestAccount} />}

      <MailPendingList
        items={inbox.items}
        senders={inbox.senders}
        folders={folders}
        apiUrl={apiUrl}
        fetcher={fetcher}
        busyId={inbox.busyId}
        bulkProgress={inbox.bulkProgress}
        canAssign={inbox.canAssign}
        onPreview={inbox.openPreview}
        onAssign={inbox.assignToFolder}
        onAssignBulk={inbox.assignItemsBulk}
        onExcludeSender={inbox.toggleSenderExclusion}
        onDiscard={inbox.discardItem}
        onDiscardBulk={inbox.discardItemsBulk}
      />

      {inbox.previewItem && <MailPreviewModal preview={inbox.previewItem} onClose={inbox.closePreview} />}
    </div>
  );
}
