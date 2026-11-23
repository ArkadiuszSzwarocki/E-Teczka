import { useCallback, useEffect, useState } from 'react';
import type { DocumentRecord, FolderRecord } from '../types/domain';
import { formatBytes } from '../services/documentUpload';
import FolderPropertiesModal from './FolderPropertiesModal';
import DocumentThumbnail from './DocumentThumbnail';
import FolderIconPicker, { AppFolderIcon, FolderIconView, VAULT_ICON_ID } from './FolderIconPicker';
import FolderCreateModal from './FolderCreateModal';
import FolderVaultSetupModal from './FolderVaultSetupModal';
import FolderVaultUnlockModal from './FolderVaultUnlockModal';
import RetentionBadge from './RetentionBadge';
import RodoUnlockBadge from './RodoUnlockBadge';
import DocumentTagCorner, { getTagTileStyle } from './DocumentTagCorner';
import FoldersFilterBar from './FoldersFilterBar';
import { useFolderVaultGuard } from '../hooks/useFolderVaultGuard';
import { useFoldersDragDrop } from '../hooks/useFoldersDragDrop';
import { countFolderTreeStats } from '../utils/folderTree';
import { collectDocumentTags, DEFAULT_DOC_FILTER, filterAndSortDocuments, type DocFilterState } from '../utils/documentFilterSort';
import { isMobileBrowser } from '../services/platform';

const VIEW_KEY = 'mojateczka_folders_view_mode_v1';

/** Folder and document desktop view with icon/list modes, drag-and-drop, and Safe Vault protection. */
export default function FoldersDesktop({
  apiUrl, fetcher, plan, accountEmail, folders, documents, selectedDocs, onToggleSelect, onSelectAllVisible, onClearSelected, onOpenFolder, onOpenPreview,
  onHoverEnter, onHoverLeave,
  onCreateFolder, onDiscardEmptyFolder, onRenameFolder, onDeleteFolder, onReorderFolders, onMoveFolderParent, onMoveDocument, onUploadToFolder,
  onTrashDoc, onShareLink, onShareClassic, onOpenOcr, onExportPdf, onPropertiesDoc, onEditRetention,
  onExportFolderHistory, historyBusy = false, onOpenFolderQrLabel,
}: {
  apiUrl: string; fetcher: typeof fetch; plan: 'free' | 'standard' | 'premium' | 'family' | 'business'; accountEmail?: string; folders: FolderRecord[]; documents: DocumentRecord[]; selectedDocs: number[];
  onToggleSelect: (id: number) => void; onSelectAllVisible: (ids: number[]) => void; onClearSelected: () => void; onOpenFolder: (folderId: number) => void; onOpenPreview: (doc: DocumentRecord) => void;
  onHoverEnter: (doc: DocumentRecord, anchor: HTMLElement) => void; onHoverLeave: () => void;
  onCreateFolder: (name: string, parentId: number | null) => Promise<number | null>;
  onDiscardEmptyFolder?: (id: number) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  onDeleteFolder: (id: number, name: string) => void;
  onReorderFolders: (orderedIds: number[]) => Promise<void>;
  onMoveFolderParent: (id: number, parentId: number | null) => Promise<void>;
  onMoveDocument: (docId: number, folderId: number) => Promise<void>;
  onUploadToFolder: (folderId: number) => void;
  onTrashDoc: (doc: DocumentRecord) => void;
  onShareLink: (doc: DocumentRecord) => void; onShareClassic: (doc: DocumentRecord) => void; onOpenOcr: (doc: DocumentRecord) => void; onExportPdf: (doc: DocumentRecord, watermark?: boolean) => void; onPropertiesDoc: (doc: DocumentRecord) => void;
  onEditRetention: (doc: DocumentRecord) => void;
  onExportFolderHistory?: (folderId: number, folderName: string) => void;
  historyBusy?: boolean;
  onOpenFolderQrLabel?: (folder: { id: number; name: string }) => void;
}) {
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'icons' | 'list'>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'icons'));
  const [creating, setCreating] = useState(false);
  const [pendingVaultFolderId, setPendingVaultFolderId] = useState<number | null>(null);
  const [menuFolderId, setMenuFolderId] = useState<number | null>(null);
  const [iconPickerId, setIconPickerId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [docMenuId, setDocMenuId] = useState<number | null>(null);
  const [activeDocId, setActiveDocId] = useState<number | null>(null);
  const [propertiesFolder, setPropertiesFolder] = useState<FolderRecord | null>(null);
  const [docFilter, setDocFilter] = useState<DocFilterState>(DEFAULT_DOC_FILTER);

  const closeFolderMenus = useCallback(() => {
    setMenuFolderId(null);
    setIconPickerId(null);
  }, []);

  useEffect(() => {
    const closeMenus = () => { closeFolderMenus(); setDocMenuId(null); };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, [closeFolderMenus]);

  const vault = useFolderVaultGuard({ apiUrl, fetcher, folders, currentFolderId, onMenusClose: closeFolderMenus });

  const breadcrumbs: FolderRecord[] = [];
  let cursor = currentFolderId;
  const seen = new Set<number>();
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const f = folders.find(item => item.id === cursor);
    if (!f) break;
    breadcrumbs.unshift(f);
    cursor = f.parentId;
  }

  const visibleFolders = folders.filter(f => f.parentId === currentFolderId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
  const folderDocs = currentFolderId === null ? [] : documents.filter(d => Number(d.folderId) === Number(currentFolderId) && !d.isArchived && !d.isDeleted);
  const availableTags = collectDocumentTags(folderDocs);
  const visibleDocs = filterAndSortDocuments(folderDocs, docFilter);
  const hasActiveFilter = docFilter.tagId !== '' || docFilter.retentionFilter !== 'all' || docFilter.retentionFrom !== '' || docFilter.retentionTo !== '' || docFilter.typeFilter !== 'all';
  const hideThreeDots = selectedDocs.length > 1;
  const allowDrag = !isMobileBrowser();

  const dnd = useFoldersDragDrop({
    folders, visibleFolders, breadcrumbs, currentFolderId,
    onReorderFolders, onMoveFolderParent, onMoveDocument,
  });

  const toggleView = () => {
    const next = viewMode === 'icons' ? 'list' : 'icons';
    setViewMode(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  const submitCreate = async (name: string, icon: string) => {
    const createdId = await onCreateFolder(name, currentFolderId);
    setCreating(false);
    if (createdId && icon === VAULT_ICON_ID) setPendingVaultFolderId(createdId);
    if (createdId && icon !== '📁') void vault.setFolderIcon(createdId, icon, name);
  };

  const renderFolderMenu = (folder: FolderRecord, posClass: string, includeFullTable: boolean) => (
    <div onClick={e => e.stopPropagation()} className={`absolute ${posClass} z-40 w-48 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl`}>
      <button type="button" onClick={() => { setMenuFolderId(null); void vault.openFolderGuarded(folder.id, () => setCurrentFolderId(folder.id)); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Otwórz</button>
      <button type="button" onClick={() => { setMenuFolderId(null); void vault.openFolderGuarded(folder.id, () => onUploadToFolder(folder.id)); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Wgraj dokumenty</button>
      {includeFullTable && <button type="button" onClick={() => { setMenuFolderId(null); void vault.openFolderGuarded(folder.id, () => onOpenFolder(folder.id)); }} className="w-full px-3 py-2 text-blue-300 hover:bg-slate-700">Widok pełnej tabeli</button>}
      {includeFullTable && <button type="button" onClick={() => { setRenamingId(folder.id); setRenameValue(folder.name); setMenuFolderId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Zmień nazwę</button>}
      <button type="button" onClick={() => setIconPickerId(iconPickerId === folder.id ? null : folder.id)} className="w-full px-3 py-2 text-blue-300 hover:bg-slate-700">Zmień ikonę</button>
      {iconPickerId === folder.id && <FolderIconPicker plan={plan} onSelect={ic => vault.setFolderIcon(folder.id, ic)} />}
      {onExportFolderHistory && (
        <button type="button" disabled={historyBusy} onClick={() => { setMenuFolderId(null); onExportFolderHistory(folder.id, folder.name); }} className="w-full px-3 py-2 text-cyan-300 hover:bg-slate-700 disabled:opacity-50">📘 Historia PDF</button>
      )}
      {onOpenFolderQrLabel && (
        <button type="button" onClick={() => { setMenuFolderId(null); onOpenFolderQrLabel({ id: folder.id, name: folder.name }); }} className="w-full px-3 py-2 text-amber-300 hover:bg-slate-700">🏷️ Etykieta QR</button>
      )}
      <button type="button" onClick={() => { setMenuFolderId(null); setPropertiesFolder(folder); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">ℹ️ Właściwości</button>
      <button type="button" onClick={() => { setMenuFolderId(null); onDeleteFolder(folder.id, folder.name); }} className="w-full px-3 py-2 text-red-300 hover:bg-slate-700">Usuń kartotekę</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="cyber-toolbar flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#111827] px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm">
          <button type="button" onClick={() => setCurrentFolderId(null)} {...dnd.dragOverTargetProps(null, true)} className={`flex items-center gap-1.5 rounded px-2 py-1 font-semibold transition ${dnd.dragOverTarget === 'root' ? 'ring-2 ring-blue-400 bg-blue-500/20 text-blue-200' : currentFolderId === null ? 'bg-blue-600/20 text-blue-300' : 'text-slate-300 hover:bg-slate-800'}`}>
            <AppFolderIcon size="sm" /> <span>Kartoteki</span>
          </button>
          {breadcrumbs.map(b => (
            <span key={b.id} className="flex items-center gap-1.5">
              <span className="text-slate-600">/</span>
              <button type="button" onClick={() => setCurrentFolderId(b.id)} {...dnd.dragOverTargetProps(b.id, true)} className={`rounded px-2 py-1 font-semibold transition ${dnd.dragOverTarget === b.id ? 'ring-2 ring-blue-400 bg-blue-500/20 text-blue-200' : currentFolderId === b.id ? 'bg-blue-600/20 text-blue-300' : 'text-slate-300 hover:bg-slate-800'}`}>
                <FolderIconView icon={vault.icons[b.id] || '📁'} size="sm" /> {b.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {visibleDocs.length > 0 && (
            <button type="button" onClick={() => visibleDocs.every(d => selectedDocs.includes(d.id)) ? onClearSelected() : onSelectAllVisible(visibleDocs.map(d => d.id))} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              {visibleDocs.every(d => selectedDocs.includes(d.id)) ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
            </button>
          )}
          {currentFolderId !== null && (() => {
            const activeFolder = folders.find(f => f.id === currentFolderId);
            return (
              <>
                {onExportFolderHistory && activeFolder && (
                  <button
                    type="button"
                    disabled={historyBusy}
                    onClick={() => onExportFolderHistory(activeFolder.id, activeFolder.name)}
                    title="Eksportuj raport kosztów i historię dokumentów tej kartoteki jako PDF (np. książka serwisowa auta / teczka mieszkania)"
                    className="rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-50"
                  >
                    {historyBusy ? 'PDF…' : '📘 Historia PDF'}
                  </button>
                )}
                {onOpenFolderQrLabel && activeFolder && (
                  <button
                    type="button"
                    onClick={() => onOpenFolderQrLabel({ id: activeFolder.id, name: activeFolder.name })}
                    title="Wydrukuj naklejkę QR na fizyczny segregator dla tej kartoteki"
                    className="rounded-lg border border-amber-500/50 bg-amber-950/40 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-900/50"
                  >
                    🏷️ Etykieta QR
                  </button>
                )}
                <button type="button" onClick={() => onUploadToFolder(currentFolderId)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                  ＋ Dodaj dokumenty
                </button>
              </>
            );
          })()}
          <button type="button" onClick={() => setCreating(v => !v)} className="cyber-btn-primary rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500">
            + {currentFolderId ? 'Nowa podkartoteka' : 'Nowa kartoteka'}
          </button>
          <button type="button" onClick={toggleView} className="cyber-btn-secondary rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            {viewMode === 'icons' ? '☰ Widok listy' : '⊞ Widok ikon'}
          </button>
        </div>
      </div>

      {currentFolderId !== null && folderDocs.length > 0 && (
        <FoldersFilterBar docFilter={docFilter} setDocFilter={setDocFilter} availableTags={availableTags} hasActiveFilter={hasActiveFilter} />
      )}

      {creating && <FolderCreateModal isSubfolder={currentFolderId !== null} plan={plan} onSubmit={submitCreate} onCancel={() => setCreating(false)} />}

      {visibleFolders.length === 0 && visibleDocs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-400">
          Ten katalog jest pusty. Utwórz kartotekę lub podkartotekę i uporządkuj dokumenty.
        </div>
      )}

      {viewMode === 'icons' ? (
        <div ref={dnd.foldersContainerRef} onDragOver={dnd.handleContainerDragOver} onDrop={e => { if (dnd.dragItem?.kind === 'folder') { e.preventDefault(); e.stopPropagation(); dnd.dropOnFolder(null); } }} className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {dnd.displayFolders.map((folder, index) => {
            const stats = countFolderTreeStats(folders, folder.id, id => documents.filter(d => d.folderId === id && !d.isArchived && !d.isDeleted).length);
            const isDraggingThis = dnd.dragItem?.kind === 'folder' && dnd.dragItem.id === folder.id;
            const isDropHover = dnd.dragItem?.kind === 'doc' && dnd.dragOverTarget === folder.id;
            const isShiftedGhost = isDraggingThis && dnd.dragTargetIndex !== null && visibleFolders[dnd.dragTargetIndex]?.id !== folder.id;
            const isVaultCard = vault.icons[folder.id] === 'sejf';
            return (
              <div key={folder.id} data-folder-slot={index} draggable={allowDrag} onDragStart={e => dnd.startDrag(e, { kind: 'folder', id: folder.id })} onDragEnd={dnd.endDrag} {...dnd.dragOverTargetProps(folder.id)} onClick={() => { if (renamingId !== folder.id) void vault.openFolderGuarded(folder.id, () => setCurrentFolderId(folder.id)); }} className={`group relative flex cursor-pointer flex-col items-center rounded-xl border p-4 text-center transition-all duration-200 ${menuFolderId === folder.id || iconPickerId === folder.id ? 'z-30' : ''} ${isDraggingThis ? 'border-2 border-dashed border-blue-400 bg-blue-500/10 ring-2 ring-blue-400/40 opacity-80' : isDropHover ? 'scale-[1.03] border-blue-400 bg-blue-500/15 ring-2 ring-blue-400' : `${isVaultCard ? 'cyber-card cyber-card-vault' : 'cyber-card'} border-slate-700 bg-[#1e293b] hover:border-blue-400/70 hover:bg-slate-800/80`}`}>
                <div className={`cyber-card-orb pointer-events-none absolute -left-10 -top-10 h-24 w-24 rounded-full blur-2xl transition-all duration-300 ${isVaultCard ? 'bg-red-500/15 group-hover:bg-red-500/25' : 'bg-cyan-500/10 group-hover:bg-cyan-500/20'}`} />
                {(isShiftedGhost || isDropHover) && (
                  <span className="pointer-events-none absolute -top-2.5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-bold text-white shadow">Upuść tutaj</span>
                )}
                <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-0.5 text-[10px] font-medium text-slate-400">
                  <span title={`Kartoteki wewnątrz: ${stats.subfolders}`} className="inline-flex items-center gap-1"><AppFolderIcon size="xs" /> {stats.subfolders}</span>
                  <span title={`Pliki łącznie: ${stats.files}`}>📄 {stats.files}</span>
                </div>
                {!hideThreeDots && (
                  <button type="button" aria-label="Opcje kartoteki" onClick={e => { e.stopPropagation(); setMenuFolderId(menuFolderId === folder.id ? null : folder.id); setIconPickerId(null); }} className="absolute right-2 top-2 rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white">⋮</button>
                )}
                <div className="mt-1"><FolderIconView icon={vault.icons[folder.id] || '📁'} /></div>
                {renamingId === folder.id ? (
                  <input autoFocus onClick={e => e.stopPropagation()} value={renameValue} onChange={e => setRenameValue(e.target.value)} onBlur={() => { if (renameValue.trim()) void onRenameFolder(folder.id, renameValue.trim()); setRenamingId(null); }} onKeyDown={e => { if (e.key === 'Enter' && renameValue.trim()) { void onRenameFolder(folder.id, renameValue.trim()); setRenamingId(null); } }} className="mt-2 w-full rounded border border-blue-400 bg-slate-950 px-2 py-1 text-center text-xs text-white" />
                ) : (
                  <span className="mt-2 line-clamp-2 text-sm font-semibold text-slate-100">{folder.name}</span>
                )}
                {menuFolderId === folder.id && !hideThreeDots && renderFolderMenu(folder, 'right-2 top-9', true)}
              </div>
            );
          })}

          {visibleDocs.map(doc => {
            const checked = selectedDocs.includes(doc.id);
            const active = activeDocId === doc.id;
            const isDraggingDoc = dnd.dragItem?.kind === 'doc' && dnd.dragItem.id === doc.id;
            return (
              <div key={doc.id} draggable={allowDrag} onDragStart={e => dnd.startDrag(e, { kind: 'doc', id: doc.id })} onDragEnd={dnd.endDrag} onClick={() => { setActiveDocId(doc.id); onOpenPreview(doc); }} style={getTagTileStyle(doc, checked)} className={`group relative flex cursor-pointer flex-col items-center rounded-xl border p-4 text-center transition ${isDraggingDoc ? 'scale-95 opacity-40' : active ? 'border-cyan-400 bg-cyan-950/35 ring-2 ring-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.25)]' : checked ? 'border-blue-500 bg-blue-950/30' : 'border-slate-700 bg-[#1e293b] hover:border-slate-500'}`}>
                <input type="checkbox" checked={checked} onClick={e => e.stopPropagation()} onChange={() => onToggleSelect(doc.id)} aria-label={`Zaznacz ${doc.title}`} className="absolute left-2.5 top-2.5 h-4 w-4 accent-blue-500" />
                <DocumentTagCorner document={doc} hideThreeDots={hideThreeDots} />
                {!hideThreeDots && (
                  <button type="button" aria-label="Menu dokumentu" onClick={e => { e.stopPropagation(); setActiveDocId(doc.id); setDocMenuId(docMenuId === doc.id ? null : doc.id); setMenuFolderId(null); }} className="absolute right-2 top-2 rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white">⋮</button>
                )}
                <button type="button" onClick={e => { e.stopPropagation(); setActiveDocId(doc.id); onOpenPreview(doc); }} onMouseEnter={e => onHoverEnter(doc, e.currentTarget)} onMouseLeave={onHoverLeave} className="mt-3 flex h-16 w-14 items-center justify-center overflow-hidden rounded border border-slate-700 bg-slate-900">
                  <DocumentThumbnail apiUrl={apiUrl} fetcher={fetcher} document={doc} />
                </button>
                <span title={doc.title} onClick={e => { e.stopPropagation(); setActiveDocId(doc.id); onOpenPreview(doc); }} className="mt-2 line-clamp-2 w-full min-w-0 max-w-full break-all cursor-pointer text-xs font-semibold text-slate-200">{doc.title}</span>
                {typeof doc.fileSize === 'number' && doc.fileSize > 0 && (
                  <span className="mt-0.5 text-[11px] text-slate-400">{formatBytes(doc.fileSize)}</span>
                )}
                <RetentionBadge document={doc} className="mt-1" />
                <RodoUnlockBadge docId={doc.id} className="mt-1" />
                {doc.readOnly && <span className="mt-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300">Tylko do odczytu</span>}
                {docMenuId === doc.id && !hideThreeDots && (
                  <div onClick={e => e.stopPropagation()} className="absolute right-2 top-9 z-40 w-48 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl">
                    {!doc.readOnly && <button type="button" onClick={() => { onEditRetention(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Edytuj termin życia</button>}
                    {!doc.readOnly && <button type="button" onClick={() => { onShareLink(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Bezpieczny link</button>}
                    {!doc.readOnly && <button type="button" onClick={() => { onShareClassic(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Udostępnij klasycznie</button>}
                    {!doc.readOnly && <button type="button" onClick={() => { onOpenOcr(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-blue-300 hover:bg-slate-700">Rozpoznany tekst (OCR)</button>}
                    {!doc.readOnly && <button type="button" onClick={() => { onExportPdf(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Eksportuj do PDF</button>}
                    {!doc.readOnly && <button type="button" onClick={() => { onExportPdf(doc, true); setDocMenuId(null); }} className="w-full px-3 py-2 text-cyan-300 hover:bg-slate-700">Znak wodny (PDF)</button>}
                    <button type="button" onClick={() => { onPropertiesDoc(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">ℹ️ Właściwości</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={dnd.foldersContainerRef} onDragOver={dnd.handleContainerDragOver} onDrop={e => { if (dnd.dragItem?.kind === 'folder') { e.preventDefault(); e.stopPropagation(); dnd.dropOnFolder(null); } }} className="overflow-hidden rounded-lg border border-slate-700 bg-[#1e293b]">
          {dnd.displayFolders.map((folder, index) => {
            const isDraggingThis = dnd.dragItem?.kind === 'folder' && dnd.dragItem.id === folder.id;
            const isDropHover = dnd.dragItem?.kind === 'doc' && dnd.dragOverTarget === folder.id;
            return (
              <div key={folder.id} data-folder-slot={index} draggable onDragStart={e => dnd.startDrag(e, { kind: 'folder', id: folder.id })} onDragEnd={dnd.endDrag} {...dnd.dragOverTargetProps(folder.id)} className={`relative flex items-center justify-between border-b border-slate-700/60 px-4 py-3 transition ${isDraggingThis ? 'border-dashed bg-blue-500/10 ring-2 ring-inset ring-blue-400/60 opacity-80' : isDropHover ? 'bg-blue-500/15 ring-2 ring-inset ring-blue-400' : 'hover:bg-slate-800/60'}`}>
                <button type="button" onClick={() => void vault.openFolderGuarded(folder.id, () => setCurrentFolderId(folder.id))} className="flex items-center gap-3 text-left font-semibold text-white">
                  <FolderIconView icon={vault.icons[folder.id] || '📁'} size="sm" />
                  <span>{folder.name}</span>
                  {Boolean(folder._count?.documents) && <span className="text-xs font-normal text-slate-400">({folder._count?.documents} dok.)</span>}
                </button>
                {!hideThreeDots && <button type="button" onClick={e => { e.stopPropagation(); setMenuFolderId(menuFolderId === folder.id ? null : folder.id); }} className="rounded px-2 py-1 text-lg text-slate-300 hover:bg-slate-700">⋮</button>}
                {menuFolderId === folder.id && !hideThreeDots && renderFolderMenu(folder, 'right-4 top-10', false)}
              </div>
            );
          })}
          {visibleDocs.map(doc => (
            <div key={doc.id} draggable onDragStart={e => dnd.startDrag(e, { kind: 'doc', id: doc.id })} onDragEnd={dnd.endDrag} onClick={() => setActiveDocId(doc.id)} className={`relative flex items-center justify-between border-b border-slate-700/60 px-4 py-3 transition ${activeDocId === doc.id ? 'bg-cyan-950/35 ring-1 ring-inset ring-cyan-400' : 'hover:bg-slate-800/60'}`}>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => onToggleSelect(doc.id)} className="h-4 w-4 accent-blue-500" />
                <button type="button" onClick={() => { setActiveDocId(doc.id); onOpenPreview(doc); }} onMouseEnter={e => onHoverEnter(doc, e.currentTarget)} onMouseLeave={onHoverLeave} className="font-medium text-slate-200 hover:text-white">{doc.title}</button>
                {typeof doc.fileSize === 'number' && doc.fileSize > 0 && (
                  <span className="text-xs text-slate-400">({formatBytes(doc.fileSize)})</span>
                )}
                <RetentionBadge document={doc} />
                {doc.readOnly && <span className="rounded bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">Tylko do odczytu</span>}
              </div>
              {!hideThreeDots && (
                <div className="flex items-center gap-2">
                  {!doc.readOnly && <button type="button" onClick={() => onEditRetention(doc)} className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">Termin życia</button>}
                  <button type="button" onClick={() => onTrashDoc(doc)} className="rounded px-2 py-1 text-xs text-red-300 hover:bg-slate-700">Do kosza</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {propertiesFolder && (
        <FolderPropertiesModal
          folder={propertiesFolder}
          folders={folders}
          documents={documents}
          icon={vault.icons[propertiesFolder.id] || '📁'}
          isVault={vault.icons[propertiesFolder.id] === VAULT_ICON_ID}
          onClose={() => setPropertiesFolder(null)}
        />
      )}
      {vault.vaultSetupTarget && (
        <FolderVaultSetupModal
          apiUrl={apiUrl}
          fetcher={fetcher}
          folderId={vault.vaultSetupTarget.id}
          folderName={vault.vaultSetupTarget.name}
          accountEmail={accountEmail}
          onConfigured={() => {
            setPendingVaultFolderId(null);
            vault.markVaultConfigured(vault.vaultSetupTarget!.id);
          }}
          onCancel={() => {
            const targetId = vault.vaultSetupTarget?.id;
            vault.setVaultSetupTarget(null);
            if (targetId && pendingVaultFolderId === targetId) {
              setPendingVaultFolderId(null);
              void onDiscardEmptyFolder?.(targetId);
            }
          }}
        />
      )}
      {vault.vaultUnlockTarget && (
        <FolderVaultUnlockModal
          apiUrl={apiUrl}
          fetcher={fetcher}
          folderId={vault.vaultUnlockTarget.id}
          folderName={vault.vaultUnlockTarget.name}
          loginMethod={vault.vaultUnlockTarget.loginMethod}
          onUnlocked={vault.markVaultUnlocked}
          onCancel={() => vault.setVaultUnlockTarget(null)}
        />
      )}
    </div>
  );
}
