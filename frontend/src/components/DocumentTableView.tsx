import DocumentThumbnail from './DocumentThumbnail';
import { formatFileSize, getExpiryDate } from '../utils/documentLifecycle';
import { shareDocumentClassic } from '../services/classicShare';
import { errorMessage } from '../utils/errors';
import type { PendingAction } from './DestructiveActionModal';
import type { DocumentPatch, DocumentRecord, Tag } from '../types/domain';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  documents: DocumentRecord[];
  displayedDocs: DocumentRecord[];
  selectedDocs: number[];
  tags: Tag[];
  documentMenuId: number | null;
  setDocumentMenuId: (id: number | null) => void;
  renamingDocId: number | null;
  setRenamingDocId: (id: number | null) => void;
  renamingDocTitle: string;
  setRenamingDocTitle: (title: string) => void;
  onToggleSelect: (id: number) => void;
  onSelectAllVisible: () => void;
  onClearSelected: () => void;
  onRecognizeSelected: () => void;
  onOpenBulkMove: () => void;
  onInitiateAction: (type: PendingAction['type'], id: number, name: string) => void;
  onOpenPreview: (doc: DocumentRecord) => void;
  onHoverEnter: (doc: DocumentRecord, anchor: HTMLElement) => void;
  onHoverLeave: () => void;
  onUpdateDocument: (id: number, data: DocumentPatch) => Promise<void> | void;
  onOpenMoveModal: (docId: number) => void;
  onBeginRestore: (doc: Pick<DocumentRecord, 'id'>, from: 'archive' | 'trash') => void;
  onEditRetention: (doc: DocumentRecord) => void;
  onOpenSecureShare: (docId: number) => void;
  onOpenOcr: (docId: number) => void;
  showToast: (msg: string, type?: string) => void;
};

/** Full-width document table with bulk selection bar, inline renaming, and per-row action menu. */
export default function DocumentTableView({
  apiUrl, fetcher, activeView, documents, displayedDocs, selectedDocs, tags,
  documentMenuId, setDocumentMenuId, renamingDocId, setRenamingDocId, renamingDocTitle, setRenamingDocTitle,
  onToggleSelect, onSelectAllVisible, onClearSelected, onRecognizeSelected, onOpenBulkMove, onInitiateAction,
  onOpenPreview, onHoverEnter, onHoverLeave, onUpdateDocument, onOpenMoveModal, onBeginRestore,
  onEditRetention, onOpenSecureShare, onOpenOcr, showToast,
}: Props) {
  const hasReadOnlySelected = documents.some(d => selectedDocs.includes(d.id) && d.readOnly);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-950/30 px-3 py-2">
        <button type="button" onClick={() => selectedDocs.length === displayedDocs.length ? onClearSelected() : onSelectAllVisible()} className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
          {selectedDocs.length === displayedDocs.length && displayedDocs.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
        </button>
        {selectedDocs.length > 0 && (
          <>
            <span className="px-1 text-xs font-semibold text-blue-200">Wybrano: {selectedDocs.length}</span>
            {activeView !== 'trash' && (
              <button type="button" disabled={hasReadOnlySelected} onClick={onRecognizeSelected} className="rounded border border-blue-400 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/10 disabled:opacity-40">
                Rozpoznaj tekst (OCR)
              </button>
            )}
            <button type="button" disabled={hasReadOnlySelected && (activeView === 'trash' || activeView === 'archive')} onClick={onOpenBulkMove} className="rounded border border-indigo-500/70 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40">
              {activeView === 'trash' || activeView === 'archive' ? 'Przywróć do kartoteki' : 'Przenieś'}
            </button>
            {activeView !== 'archive' && activeView !== 'trash' && (
              <button type="button" onClick={() => onInitiateAction('bulk_archive', 0, String(selectedDocs.length))} className="rounded border border-amber-600/70 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-600/10">
                Archiwizuj
              </button>
            )}
            {activeView === 'trash' ? (
              <button type="button" onClick={() => onInitiateAction('bulk_delete', 0, String(selectedDocs.length))} className="rounded border border-red-500/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">Usuń trwale</button>
            ) : (
              <button type="button" onClick={() => onInitiateAction('bulk_trash', 0, String(selectedDocs.length))} className="rounded border border-red-500/70 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">Do kosza</button>
            )}
          </>
        )}
      </div>
      <div className="overflow-visible rounded-lg border border-slate-700 bg-[#1e293b] shadow-xl">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-700 bg-[#0f172a]/50 text-xs font-semibold tracking-wider text-slate-400">
              <th className="w-12 p-4 text-center">✓</th>
              <th className="w-20 p-4">PODGLĄD</th>
              <th className="p-4">DOKUMENT I TAGI</th>
              <th className="p-4">DODANO</th>
              <th className="p-4">TERMIN ŻYCIA</th>
              <th className="p-4">WGRYWAJĄCY</th>
              <th className="p-4">ROZMIAR</th>
              <th className="p-4 pr-6 text-right">MENU</th>
            </tr>
          </thead>
          <tbody>
            {displayedDocs.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center italic text-slate-500">Brak dokumentów w tym widoku.</td></tr>
            ) : displayedDocs.map(doc => (
              <tr key={doc.id} className="group border-b border-slate-700/50 transition-colors hover:bg-[#374151]/30">
                <td className="p-4 text-center">
                  <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => onToggleSelect(doc.id)} className="h-4 w-4 cursor-pointer rounded border-slate-600 bg-[#111827] text-blue-500 focus:ring-0" />
                </td>
                <td className="relative p-4">
                  <div className="flex items-center justify-center">
                    <div
                      className="relative z-10 flex h-16 w-14 cursor-pointer items-center justify-center overflow-hidden rounded border border-slate-600 bg-[#0f172a] transition-all hover:border-blue-500 hover:shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                      onClick={() => onOpenPreview(doc)}
                      onMouseEnter={event => onHoverEnter(doc, event.currentTarget)}
                      onMouseLeave={onHoverLeave}
                    >
                      <DocumentThumbnail document={doc} apiUrl={apiUrl} fetcher={fetcher} />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-colors hover:bg-blue-500/20 hover:opacity-100">
                        <span className="pointer-events-none rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white shadow">Powiększ</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex flex-col">
                    {renamingDocId === doc.id ? (
                      <input type="text" autoFocus value={renamingDocTitle} onChange={e => setRenamingDocTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { void onUpdateDocument(doc.id, { title: renamingDocTitle }); setRenamingDocId(null); } if (e.key === 'Escape') setRenamingDocId(null); }} onBlur={() => setRenamingDocId(null)} className="mb-1 w-full max-w-sm rounded border border-blue-500 bg-[#0f172a] px-2 py-1 text-sm text-white outline-none" />
                    ) : (
                      <div className="group/title flex items-center gap-2">
                        <span className="max-w-sm truncate text-sm font-bold text-slate-200" title={doc.title}>{doc.title}</span>
                        <button type="button" onClick={() => { setRenamingDocId(doc.id); setRenamingDocTitle(doc.title); }} className="text-blue-400 opacity-0 transition-opacity hover:text-white group-hover/title:opacity-100" title="Zmień nazwę pliku">✎</button>
                      </div>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {doc.readOnly && <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] text-amber-200">Tylko do odczytu — limit planu</span>}
                      {(doc.tags || []).map(entry => (
                        <span key={entry.tagId} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.tag.inactive ? 'bg-slate-700 text-slate-400' : 'text-white'}`} style={entry.tag.inactive ? undefined : { backgroundColor: entry.tag.color }}>
                          {entry.tag.name}{entry.tag.inactive ? ' (nieaktywny)' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span className="text-xs text-slate-300">{new Date(doc.createdAt).toLocaleDateString('pl-PL')}</span><br />
                  <span className="text-[10px] text-slate-500">{new Date(doc.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                </td>
                <td className="p-4">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="rounded border border-slate-700 bg-[#0f172a] px-2 py-0.5 text-sm font-semibold text-slate-300">
                        {doc.isArchived || doc.retentionEnabled === false ? 'Bez terminu' : `${doc.retentionValue} ${doc.retentionUnit === 'years' ? 'lat' : doc.retentionUnit === 'months' ? 'mies.' : doc.retentionUnit === 'minutes' ? 'min.' : 'dni'}`}
                      </span>
                    </div>
                    <span className="mt-1 text-xs text-slate-500">{!doc.isArchived && getExpiryDate(doc) ? `Do kosza: ${getExpiryDate(doc)?.toLocaleDateString('pl-PL')}` : 'Brak automatycznego kosza'}</span>
                  </div>
                </td>
                <td className="p-4 text-xs text-slate-300">{doc.user?.name || doc.user?.email || 'Właściciel'}</td>
                <td className="whitespace-nowrap p-4 text-xs text-slate-300">{formatFileSize(doc.fileSize)}</td>
                <td className="p-4 align-middle">
                  <div className="relative flex justify-end">
                    {selectedDocs.length <= 1 && (
                      <button type="button" onClick={e => { e.stopPropagation(); setDocumentMenuId(documentMenuId === doc.id ? null : doc.id); }} className="rounded p-2 text-xl text-slate-300 hover:bg-slate-700 hover:text-white" aria-label="Menu dokumentu">⋮</button>
                    )}
                    {selectedDocs.length <= 1 && documentMenuId === doc.id && (
                      <div onClick={e => e.stopPropagation()} className="absolute right-0 top-10 z-40 w-52 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left shadow-2xl">
                        {doc.readOnly ? (
                          <>
                            <p className="px-3 py-2 text-xs text-amber-300">Tylko do odczytu — zmień plan lub usuń starsze dokumenty.</p>
                            {activeView !== 'trash' && activeView !== 'archive' && <button type="button" onClick={() => { onOpenMoveModal(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przenieś</button>}
                            {activeView !== 'trash' && activeView !== 'archive' && <button type="button" onClick={() => { onInitiateAction('archive_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-amber-300 hover:bg-slate-700">Archiwizuj</button>}
                            {activeView === 'trash'
                              ? <button type="button" onClick={() => { onInitiateAction('delete_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Usuń trwale</button>
                              : <button type="button" onClick={() => { onInitiateAction('trash_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Do kosza</button>}
                          </>
                        ) : (
                          <>
                            {activeView !== 'trash' && activeView !== 'archive' && <button type="button" onClick={() => { onOpenMoveModal(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przenieś</button>}
                            {activeView === 'trash' ? (
                              <>
                                <button type="button" onClick={() => { onBeginRestore(doc, 'trash'); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700">Przywróć</button>
                                <button type="button" onClick={() => { onInitiateAction('delete_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Usuń trwale</button>
                              </>
                            ) : (
                              <>
                                {activeView === 'archive'
                                  ? <button type="button" onClick={() => { onBeginRestore(doc, 'archive'); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Przywróć</button>
                                  : <button type="button" onClick={() => { onInitiateAction('archive_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-amber-300 hover:bg-slate-700">Archiwizuj</button>}
                                {!doc.isArchived && <button type="button" onClick={() => { onEditRetention(doc); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Edytuj termin życia</button>}
                                <button type="button" onClick={() => { onInitiateAction('trash_doc', doc.id, doc.title); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-red-300 hover:bg-slate-700">Do kosza</button>
                              </>
                            )}
                            {!doc.isDeleted && <button type="button" onClick={() => { onOpenSecureShare(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700">Bezpieczny link</button>}
                            {!doc.isDeleted && <button type="button" onClick={() => { setDocumentMenuId(null); void shareDocumentClassic(apiUrl, fetcher, doc).then(mode => showToast(mode === 'shared' ? 'Udostępniono dokument.' : 'Pobrano dokument na dysk do wysłania.', 'success')).catch(error => { if ((error as { name?: string })?.name !== 'AbortError') showToast(errorMessage(error, 'Nie udało się udostępnić dokumentu.'), 'error'); }); }} className="w-full px-3 py-2 text-sm text-slate-200 hover:bg-slate-700">Udostępnij klasycznie</button>}
                            <button type="button" onClick={() => { onOpenOcr(doc.id); setDocumentMenuId(null); }} className="w-full px-3 py-2 text-sm text-blue-300 hover:bg-slate-700">Rozpoznany tekst (OCR)</button>
                            <div className="my-1 border-t border-slate-700" />
                            {tags.filter(tag => !tag.inactive).map(tag => (
                              <button key={tag.id} type="button" onClick={() => { const tagIds = (doc.tags || []).filter(entry => !entry.tag.inactive).map(entry => entry.tagId); void onUpdateDocument(doc.id, { tagIds: tagIds.includes(tag.id) ? tagIds.filter(id => id !== tag.id) : [...tagIds, tag.id] }); setDocumentMenuId(null); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                                {(doc.tags || []).some(entry => entry.tagId === tag.id) ? '✓ ' : ''}{tag.name}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
