import { useState } from 'react';
import AnalyticsDashboard from '../AnalyticsDashboard';
import ArchiveDesktop from '../ArchiveDesktop';
import DocumentTableView from '../DocumentTableView';
import { AppFolderIcon } from '../FolderIconPicker';
import FolderQrLabelModal from '../FolderQrLabelModal';
import FolderTemplateOnboardingModal from '../FolderTemplateOnboardingModal';
import FoldersDesktop from '../FoldersDesktop';
import TrashDesktop from '../TrashDesktop';
import { createFolder, moveFolderToParent, renameFolder, reorderFolders } from '../../services/folderApi';
import { shareDocumentClassic } from '../../services/classicShare';
import { errorMessage } from '../../utils/errors';
import type { useDocumentAndFolderActions } from '../../hooks/useDocumentAndFolderActions';
import type { DocumentRecord, FolderRecord, Tag } from '../../types/domain';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  apiFetch: typeof fetch;
  activeView: string;
  setActiveView: (v: string) => void;
  selectedFolderId: number | null;
  setSelectedFolderId: (id: number | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  documents: DocumentRecord[];
  displayedDocs: DocumentRecord[];
  folders: FolderRecord[];
  tags: Tag[];
  selectedDocs: number[];
  setSelectedDocs: (ids: number[]) => void;
  scannerFileCount: number;
  billingPlan: 'free' | 'standard' | 'premium' | 'family' | 'business';
  accountEmail: string;
  documentMenuId: number | null;
  setDocumentMenuId: (id: number | null) => void;
  renamingDocId: number | null;
  setRenamingDocId: (id: number | null) => void;
  renamingDocTitle: string;
  setRenamingDocTitle: (t: string) => void;
  needsDiskReconnect: boolean;
  diskFolderName?: string;
  diskBusy: boolean;
  onReconnectDisk: () => void;
  onOpenScanner: () => void;
  onOpenUploadToFolder: (folderId: number) => void;
  onOpenPreview: (doc: DocumentRecord) => void;
  onHoverEnter: (doc: DocumentRecord, anchor: HTMLElement) => void;
  onHoverLeave: () => void;
  onOpenBulkMove: () => void;
  onOpenMoveModal: (id: number) => void;
  onOpenSecureShare: (id: number) => void;
  onOpenOcr: (id: number) => void;
  onPropertiesDoc: (doc: DocumentRecord) => void;
  onFetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
  actions: ReturnType<typeof useDocumentAndFolderActions>;
};

/** Renders the main document/folder workspace header and active view (dashboard, folder, archive, trash, analytics, search). */
export function DocumentsWorkspaceSection(props: Props) {
  const {
    apiUrl, fetcher, apiFetch, activeView, setActiveView, selectedFolderId, setSelectedFolderId,
    searchQuery, setSearchQuery, documents, displayedDocs, folders, tags, selectedDocs, setSelectedDocs,
    scannerFileCount, billingPlan, accountEmail, documentMenuId, setDocumentMenuId,
    renamingDocId, setRenamingDocId, renamingDocTitle, setRenamingDocTitle,
    needsDiskReconnect, diskFolderName, diskBusy, onReconnectDisk,
    onOpenScanner, onOpenUploadToFolder, onOpenPreview, onHoverEnter, onHoverLeave,
    onOpenBulkMove, onOpenMoveModal, onOpenSecureShare, onOpenOcr, onPropertiesDoc,
    onFetchData, showToast, actions,
  } = props;

  const [templateDismissed, setTemplateDismissed] = useState(() => localStorage.getItem('mojateczka_template_onboarding_dismissed') === '1');
  const [qrLabelFolder, setQrLabelFolder] = useState<{ id: number; name: string } | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  const exportFolderHistoryPdf = async (folderId: number, folderName: string) => {
    setHistoryBusy(true);
    try {
      const res = await fetcher(`${apiUrl}/api/folders/${folderId}/history-pdf`);
      if (!res.ok) throw new Error('Nie udało się wygenerować raportu historii.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MojaTeczka-Historia-${folderName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Wygenerowano raport historii PDF.', 'success');
    } catch (err) {
      showToast(errorMessage(err, 'Błąd eksportu historii PDF.'), 'error');
    } finally {
      setHistoryBusy(false);
    }
  };
  const dismissTemplateOnboarding = () => {
    localStorage.setItem('mojateczka_template_onboarding_dismissed', '1');
    setTemplateDismissed(true);
  };

  const shareClassic = (doc: DocumentRecord) => {
    void shareDocumentClassic(apiUrl, apiFetch, doc)
      .then(mode => showToast(mode === 'shared' ? 'Udostępniono dokument.' : 'Pobrano dokument na dysk do wysłania.', 'success'))
      .catch(error => {
        if ((error as { name?: string })?.name !== 'AbortError') {
          showToast(errorMessage(error, 'Nie udało się udostępnić dokumentu.'), 'error');
        }
      });
  };

  return (
    <div className="w-full">
      {activeView !== 'analytics' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="flex shrink-0 items-center text-2xl sm:text-3xl">
              {activeView === 'trash' ? '🗑️' : activeView === 'archive' ? '📦' : <AppFolderIcon size="md" />}
            </span>
            <h2 className="truncate text-xl font-bold tracking-wide text-white sm:text-2xl">
              {activeView === 'dashboard' ? 'Kartoteki' : activeView === 'trash' ? 'Kosz' : activeView === 'archive' ? 'Archiwum Systemowe' : (folders.find(f => f.id === selectedFolderId)?.name || 'Kartoteka')}
            </h2>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {['dashboard', 'folder', 'trash', 'archive'].includes(activeView) && (
              <div className="relative flex-1 sm:flex-initial">
                <input
                  type="text"
                  placeholder="Szukaj nazwy lub tekstu dokumentu…"
                  title="Wpisz słowo z nazwy lub treści dokumentu po rozpoznaniu OCR"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="cyber-input w-full rounded-md border border-slate-600 bg-[#111827] px-3 py-2 pr-7 text-sm text-slate-200 focus:border-blue-500 focus:outline-none sm:w-72"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} aria-label="Wyczyść wyszukiwanie" className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white">✕</button>
                )}
              </div>
            )}
            {activeView === 'trash' && displayedDocs.length > 0 && (
              <button onClick={() => actions.initiateAction('empty_trash', 0, String(displayedDocs.length))} className="rounded-md border border-red-500 px-4 py-2 text-sm font-bold text-red-300 hover:bg-red-900/40">Opróżnij kosz</button>
            )}
            {activeView === 'folder' && selectedFolderId && folders.some(f => f.id === selectedFolderId) && (
              <>
                <button
                  type="button"
                  disabled={historyBusy}
                  onClick={() => { const f = folders.find(item => item.id === selectedFolderId); if (f) void exportFolderHistoryPdf(f.id, f.name); }}
                  className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  {historyBusy ? 'PDF…' : '📘 Historia PDF'}
                </button>
                <button
                  type="button"
                  onClick={() => { const f = folders.find(item => item.id === selectedFolderId); if (f) setQrLabelFolder({ id: f.id, name: f.name }); }}
                  className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700"
                >
                  🏷️ Etykieta QR
                </button>
                <button onClick={() => onOpenUploadToFolder(selectedFolderId)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">＋ Dodaj dokument</button>
              </>
            )}
          </div>
        </div>
      )}

      {activeView === 'analytics' && !searchQuery.trim() ? (
        <AnalyticsDashboard apiUrl={apiUrl} fetcher={fetcher} scannerFileCount={scannerFileCount} onOpenScanner={onOpenScanner} onOpenDocument={docId => { const doc = documents.find(item => item.id === docId); if (doc) onOpenPreview(doc); }} />
      ) : activeView === 'dashboard' && !searchQuery.trim() && needsDiskReconnect ? (
        <div className="mx-auto my-8 max-w-md rounded-2xl border border-amber-500/40 bg-amber-950/20 p-6 text-center shadow-xl">
          <p className="text-3xl">🔒</p>
          <h2 className="mt-2 text-lg font-bold text-white">Odblokuj folder bazy danych</h2>
          <p className="mt-2 text-xs leading-relaxed text-amber-100/90">
            Po zamknięciu wszystkich kart przeglądarka wymaga ponownego potwierdzenia dostępu do folderu{diskFolderName ? ` (${diskFolderName})` : ''}, aby wczytać Twoje kartoteki i dokumenty.
          </p>
          <button type="button" disabled={diskBusy} onClick={onReconnectDisk} className="mt-4 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-50">
            {diskFolderName ? `Otwórz bazę (${diskFolderName})` : 'Wybierz folder bazy na dysku'}
          </button>
        </div>
      ) : activeView === 'dashboard' && !searchQuery.trim() ? (
        <>
          {folders.length === 0 && !templateDismissed && (
            <FolderTemplateOnboardingModal
              apiUrl={apiUrl}
              fetcher={fetcher}
              onDismiss={dismissTemplateOnboarding}
              onApplied={async (createdCount, label) => {
                dismissTemplateOnboarding();
                await onFetchData();
                showToast(`Utworzono szablon „${label}” (${createdCount} kartotek).`, 'success');
              }}
            />
          )}
          <FoldersDesktop
          apiUrl={apiUrl} fetcher={fetcher} plan={billingPlan} folders={folders} documents={documents}
          accountEmail={accountEmail} selectedDocs={selectedDocs}
          onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={setSelectedDocs} onClearSelected={actions.clearSelectedDocs}
          onOpenFolder={id => { setSelectedFolderId(id); setActiveView('folder'); }}
          onOpenPreview={onOpenPreview} onHoverEnter={onHoverEnter} onHoverLeave={onHoverLeave}
          onCreateFolder={async (name, parentId) => { const res = await createFolder(apiUrl, fetcher, name, parentId); if (res.ok) { const created = await res.json().catch(() => null) as { id?: number } | null; await onFetchData(); showToast('Utworzono kartotekę.', 'success'); return typeof created?.id === 'number' ? created.id : null; } showToast('Nie udało się utworzyć kartoteki.', 'error'); return null; }}
          onDiscardEmptyFolder={async id => { await fetcher(`${apiUrl}/api/folders/${id}/delete-safely`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'trash' }) }); await onFetchData(); }}
          onRenameFolder={async (id, name) => { const res = await renameFolder(apiUrl, fetcher, id, name); if (res.ok) { await onFetchData(); showToast('Zmieniono nazwę.', 'success'); } else showToast('Błąd zmiany nazwy.', 'error'); }}
          onDeleteFolder={(id, name) => { void actions.requestFolderDelete(id, name); }}
          onReorderFolders={async orderedIds => { const res = await reorderFolders(apiUrl, fetcher, orderedIds); if (res.ok) await onFetchData(); }}
          onMoveFolderParent={async (id, parentId) => { const res = await moveFolderToParent(apiUrl, fetcher, id, parentId); if (res.ok) { await onFetchData(); showToast('Przeniesiono kartotekę.', 'success'); } else showToast('Nie można przenieść kartoteki.', 'error'); }}
          onMoveDocument={async (docId, targetFolderId) => { await actions.updateDocument(docId, { folderId: targetFolderId }); }}
          onUploadToFolder={onOpenUploadToFolder}
          onTrashDoc={doc => actions.initiateAction('trash_doc', doc.id, doc.title)}
          onShareLink={doc => onOpenSecureShare(doc.id)}
          onShareClassic={shareClassic}
          onOpenOcr={doc => onOpenOcr(doc.id)}
          onExportPdf={(doc, watermark) => void actions.exportDocumentPdf(doc, watermark)}
          onPropertiesDoc={onPropertiesDoc}
          onEditRetention={doc => actions.setRetentionModal({ isOpen: true, docId: doc.id, value: doc.retentionValue || 5, unit: doc.retentionUnit || 'years', enabled: doc.retentionEnabled !== false })}
        />
        </>
      ) : activeView === 'archive' && !searchQuery.trim() ? (
        <ArchiveDesktop
          apiUrl={apiUrl} fetcher={fetcher} plan={billingPlan} documents={displayedDocs} selectedDocs={selectedDocs}
          onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={setSelectedDocs} onClearSelected={actions.clearSelectedDocs}
          onOpenPreview={onOpenPreview} onHoverEnter={onHoverEnter} onHoverLeave={onHoverLeave}
          onRestore={doc => actions.beginRestore(doc, 'archive')}
          onTrashDocs={(docIds, onConfirmed) => actions.initiateAction('bulk_trash', 0, String(docIds.length), null, 0, 0, { docIds, onAfter: onConfirmed })}
          onShareLink={doc => onOpenSecureShare(doc.id)} onShareClassic={shareClassic}
          onOpenOcr={doc => onOpenOcr(doc.id)} onExportPdf={(doc, watermark) => void actions.exportDocumentPdf(doc, watermark)}
          onPropertiesDoc={onPropertiesDoc}
        />
      ) : activeView === 'trash' && !searchQuery.trim() ? (
        <TrashDesktop
          apiUrl={apiUrl} fetcher={fetcher} documents={displayedDocs} selectedDocs={selectedDocs}
          onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={setSelectedDocs} onClearSelected={actions.clearSelectedDocs}
          onOpenPreview={onOpenPreview} onHoverEnter={onHoverEnter} onHoverLeave={onHoverLeave}
          onRestore={doc => actions.beginRestore(doc, 'trash')} onDeletePermanently={doc => actions.initiateAction('delete_doc', doc.id, doc.title)}
        />
      ) : (
        <DocumentTableView
          apiUrl={apiUrl} fetcher={fetcher} activeView={activeView} documents={documents} displayedDocs={displayedDocs}
          selectedDocs={selectedDocs} tags={tags} documentMenuId={documentMenuId} setDocumentMenuId={setDocumentMenuId}
          renamingDocId={renamingDocId} setRenamingDocId={setRenamingDocId} renamingDocTitle={renamingDocTitle} setRenamingDocTitle={setRenamingDocTitle}
          onToggleSelect={actions.toggleDocSelection} onSelectAllVisible={() => setSelectedDocs(displayedDocs.map(d => d.id))}
          onClearSelected={actions.clearSelectedDocs}
          onOpenBulkMove={onOpenBulkMove} onInitiateAction={(type, id, name) => actions.initiateAction(type, id, name)}
          onOpenPreview={onOpenPreview} onHoverEnter={onHoverEnter} onHoverLeave={onHoverLeave}
          onUpdateDocument={actions.updateDocument} onOpenMoveModal={onOpenMoveModal} onBeginRestore={actions.beginRestore}
          onEditRetention={doc => actions.setRetentionModal({ isOpen: true, docId: doc.id, value: doc.retentionValue || 5, unit: doc.retentionUnit || 'years', enabled: doc.retentionEnabled !== false })}
          onOpenSecureShare={onOpenSecureShare} onOpenOcr={onOpenOcr}
          onExportPdf={(doc, watermark) => void actions.exportDocumentPdf(doc, watermark)} onPropertiesDoc={onPropertiesDoc} showToast={showToast}
        />
      )}
      {qrLabelFolder && (
        <FolderQrLabelModal folderId={qrLabelFolder.id} folderName={qrLabelFolder.name} onClose={() => setQrLabelFolder(null)} />
      )}
    </div>
  );
}
