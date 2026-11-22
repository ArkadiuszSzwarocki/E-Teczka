import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderRecord } from '../../types/domain';
import type { MailItem, SenderFilterEntry } from '../../types/mailInbox';
import { MailAttachmentThumb } from './MailAttachmentThumb';
import { FolderSearchPicker } from './FolderSearchPicker';
import { MailPendingItemDetailModal } from './MailPendingItemDetailModal';
import { MailPendingPaginationBar } from './MailPendingPaginationBar';
import { ScrollFadeContainer } from '../ScrollFadeContainer';
import { buildFolderTreeEntries } from '../../utils/folderTree';

type Props = {
  items: MailItem[];
  senders?: SenderFilterEntry[];
  folders: FolderRecord[];
  apiUrl: string;
  fetcher: typeof fetch;
  busyId: string | null;
  bulkProgress?: { current: number; total: number; label: string } | null;
  canAssign: boolean;
  onPreview: (item: MailItem) => Promise<void>;
  onAssign: (itemId: string, folderId: number) => Promise<void>;
  onAssignBulk: (target: string[] | Array<{ id: string; folderId: number }>, folderId?: number) => Promise<void>;
  onExcludeSender: (email: string, excluded: boolean) => Promise<void>;
  onDiscard: (itemId: string) => Promise<void>;
  onDiscardBulk: (itemIds: string[], block?: boolean) => Promise<void>;
};

type KindFilter = 'all' | 'documents' | 'images' | 'watchFolder';
type ViewMode = 'list' | 'grid';

function isImageAttachment(item: MailItem): boolean {
  return item.mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(item.filename);
}

const isWatchFolderSource = (item: MailItem) => item.from === 'Folder obserwowany' || item.from === 'Gorący folder';

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

/** Displays paginated pending mail attachments (list or compact grid) alongside the drag-and-drop folder target list. */
export function MailPendingList({
  items, senders = [], folders, apiUrl, fetcher, busyId, bulkProgress, canAssign,
  onPreview, onAssign, onAssignBulk, onExcludeSender, onDiscard, onDiscardBulk,
}: Props) {
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [folderOverrides, setFolderOverrides] = useState<Record<string, number>>({});
  const [bulkFolderId, setBulkFolderId] = useState<number | ''>('');
  const [detailItem, setDetailItem] = useState<MailItem | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [expandedDropFolders, setExpandedDropFolders] = useState<Set<number>>(() => new Set());
  const dragHoverExpandRef = useRef<{ folderId: number; timer: number } | null>(null);

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base', numeric: true })),
    [folders],
  );
  const treeFolders = useMemo(() => buildFolderTreeEntries(folders), [folders]);
  const parentIdsWithChildren = useMemo(() => {
    const set = new Set<number>();
    for (const f of folders) {
      if (f.parentId !== null) set.add(f.parentId);
    }
    return set;
  }, [folders]);
  const visibleDropFolders = useMemo(() => {
    const byId = new Map(folders.map(f => [f.id, f]));
    return treeFolders.filter(({ folder }) => {
      let parentId = folder.parentId;
      const seen = new Set<number>();
      while (parentId !== null && byId.has(parentId) && !seen.has(parentId)) {
        if (!expandedDropFolders.has(parentId)) return false;
        seen.add(parentId);
        parentId = byId.get(parentId)!.parentId;
      }
      return true;
    });
  }, [folders, treeFolders, expandedDropFolders]);

  const toggleDropFolder = (folderId: number) => {
    setExpandedDropFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const clearDragExpandTimer = () => {
    if (dragHoverExpandRef.current) {
      window.clearTimeout(dragHoverExpandRef.current.timer);
      dragHoverExpandRef.current = null;
    }
  };

  const scheduleDragExpand = (folderId: number) => {
    if (!parentIdsWithChildren.has(folderId) || expandedDropFolders.has(folderId)) return;
    if (dragHoverExpandRef.current?.folderId === folderId) return;
    clearDragExpandTimer();
    dragHoverExpandRef.current = {
      folderId,
      timer: window.setTimeout(() => {
        setExpandedDropFolders(prev => {
          if (prev.has(folderId)) return prev;
          const next = new Set(prev);
          next.add(folderId);
          return next;
        });
        dragHoverExpandRef.current = null;
      }, 220),
    };
  };

  const effectiveItems = useMemo(() => {
    const activeRules = senders.filter(s => typeof s.folderId === 'number' && s.folderId > 0);
    if (activeRules.length === 0) return items;
    const folderById = new Map(folders.map(f => [f.id, f.name]));
    const exactRules = new Map<string, number>();
    const domainRules: Array<[string, number]> = [];
    for (const r of activeRules) {
      const key = r.email.trim().toLowerCase();
      if (key.startsWith('@')) domainRules.push([key, r.folderId!]);
      else exactRules.set(key, r.folderId!);
    }
    return items.map(item => {
      const email = (item.fromEmail || extractEmail(item.from)).toLowerCase();
      let ruleFolderId = exactRules.get(email);
      if (!ruleFolderId) {
        const hit = domainRules.find(([dom]) => email.endsWith(dom));
        if (hit) ruleFolderId = hit[1];
      }
      const folderName = ruleFolderId ? folderById.get(ruleFolderId) : undefined;
      if (!ruleFolderId || !folderName) return item;
      return {
        ...item,
        suggestedFolderId: ruleFolderId,
        suggestedFolderName: folderName,
        reason: 'Reguła nadawcy (automatyczne przypisanie)',
      };
    });
  }, [items, senders, folders]);

  const imageCount = useMemo(() => effectiveItems.filter(isImageAttachment).length, [effectiveItems]);
  const watchFolderCount = useMemo(() => effectiveItems.filter(isWatchFolderSource).length, [effectiveItems]);
  const docCount = effectiveItems.length - imageCount;
  const trimmedSearch = searchQuery.trim().toLowerCase();
  const visibleItems = useMemo(
    () => effectiveItems.filter(item => {
      if (kindFilter === 'images' && !isImageAttachment(item)) return false;
      if (kindFilter === 'documents' && isImageAttachment(item)) return false;
      if (kindFilter === 'watchFolder' && !isWatchFolderSource(item)) return false;
      if (!trimmedSearch) return true;
      return (
        item.from.toLowerCase().includes(trimmedSearch)
        || (item.fromEmail || '').toLowerCase().includes(trimmedSearch)
        || item.subject.toLowerCase().includes(trimmedSearch)
        || item.filename.toLowerCase().includes(trimmedSearch)
      );
    }),
    [effectiveItems, kindFilter, trimmedSearch],
  );

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => visibleItems.slice((safePage - 1) * pageSize, safePage * pageSize),
    [visibleItems, safePage, pageSize],
  );

  useEffect(() => {
    const existing = new Set(items.map(i => i.id));
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => existing.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allPageSelected = pagedItems.length > 0 && pagedItems.every(i => selectedIds.has(i.id));
  const allFilteredSelected = visibleItems.length > 0 && visibleItems.every(i => selectedIds.has(i.id));
  const toggleSelectPage = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) pagedItems.forEach(i => next.delete(i.id));
      else pagedItems.forEach(i => next.add(i.id));
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) visibleItems.forEach(i => next.delete(i.id));
      else visibleItems.forEach(i => next.add(i.id));
      return next;
    });
  };

  const assignedSelectedPairs = useMemo(
    () => effectiveItems
      .filter(i => selectedIds.has(i.id) && typeof i.suggestedFolderId === 'number' && i.suggestedFolderId > 0)
      .map(i => ({ id: i.id, folderId: i.suggestedFolderId! })),
    [effectiveItems, selectedIds],
  );

  const handleApproveAssignedSelected = () => {
    if (assignedSelectedPairs.length === 0) return;
    void onAssignBulk(assignedSelectedPairs).then(() => setSelectedIds(new Set()));
  };

  const handleBulkAssign = () => {
    if (!bulkFolderId || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    void onAssignBulk(ids, Number(bulkFolderId)).then(() => setSelectedIds(new Set()));
  };

  const handleBulkDiscard = (block = true) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    void onDiscardBulk(ids, block).then(() => setSelectedIds(new Set()));
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Oczekujące załączniki ({items.length})</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="search"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Szukaj (np. olx)…"
              aria-label="Szukaj w oczekujących załącznikach"
              className={`w-44 rounded-lg border px-2.5 py-1 text-xs placeholder-slate-500 transition focus:border-cyan-400 focus:outline-none ${trimmedSearch
                  ? 'border-cyan-400 bg-cyan-950/45 text-cyan-100 ring-2 ring-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                  : 'border-slate-700 bg-[#0f172a] text-white'
                }`}
            />
            <select
              value={kindFilter}
              onChange={e => { setKindFilter(e.target.value as KindFilter); setPage(1); }}
              aria-label="Filtr typu załączników"
              className={`rounded-lg border px-2 py-1 text-xs transition ${kindFilter !== 'all'
                  ? 'border-cyan-400 bg-cyan-950/45 text-cyan-100 ring-1 ring-cyan-400/50'
                  : 'border-slate-700 bg-slate-800/90 text-slate-200'
                }`}
            >
              <option value="all">Wszystkie ({items.length})</option>
              <option value="documents">📄 Dokumenty ({docCount})</option>
              <option value="images">🖼️ Zdjęcia ({imageCount})</option>
              {watchFolderCount > 0 && <option value="watchFolder">📂 Folder obserwowany ({watchFolderCount})</option>}
            </select>
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-900/70 p-0.5">
              <button type="button" title="Widok listy" onClick={() => setViewMode('list')} className={`rounded px-2 py-0.5 text-xs font-semibold ${viewMode === 'list' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}>☰</button>
              <button type="button" title="Widok małych ikon" onClick={() => setViewMode('grid')} className={`rounded px-2 py-0.5 text-xs font-semibold ${viewMode === 'grid' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'}`}>⊞</button>
            </div>
          </div>
        </div>

        {bulkProgress && (
          <div role="status" className="rounded-xl border border-emerald-500/50 bg-emerald-950/30 p-3 text-xs text-emerald-100">
            <div className="mb-1.5 flex items-center justify-between gap-2 font-semibold">
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                {bulkProgress.label}
              </span>
              <span>
                {bulkProgress.current} / {bulkProgress.total} ({Math.round((bulkProgress.current / Math.max(1, bulkProgress.total)) * 100)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.round((bulkProgress.current / Math.max(1, bulkProgress.total)) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {visibleItems.length > 0 && (
          <MailPendingPaginationBar
            page={safePage} totalPages={totalPages} pageSize={pageSize} totalItems={visibleItems.length}
            selectedCount={selectedIds.size} assignedSelectedCount={assignedSelectedPairs.length}
            allPageSelected={allPageSelected} allFilteredSelected={allFilteredSelected}
            canAssign={canAssign} folders={sortedFolders} bulkFolderId={bulkFolderId} busy={busyId === 'bulk'}
            onPageChange={setPage}
            onPageSizeChange={size => { setPageSize(size); setPage(1); }}
            onToggleSelectPage={toggleSelectPage}
            onToggleSelectAll={toggleSelectAll}
            onClearSelection={() => setSelectedIds(new Set())}
            onBulkFolderChange={setBulkFolderId}
            onApproveAssignedSelected={handleApproveAssignedSelected}
            onAssignSelected={handleBulkAssign}
            onDiscardSelected={handleBulkDiscard}
          />
        )}

        {items.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-[#1e293b] p-8 text-center text-sm text-slate-400">
            Brak załączników w poczekalni. Kliknij „Pobierz załączniki”, aby przeskanować skrzynkę.
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="rounded-xl border border-slate-700 bg-[#1e293b] p-8 text-center text-sm text-slate-400">
            Brak załączników w kategorii {kindFilter === 'images' ? '„Zdjęcia”' : '„Dokumenty”'}.
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {pagedItems.map(item => (
              <div
                key={item.id}
                draggable={!item.locked && busyId !== item.id}
                onDragStart={e => e.dataTransfer.setData('text/mail-item-id', item.id)}
                onClick={() => { setActiveItemId(item.id); setDetailItem(item); }}
                title={item.locked ? `${item.filename} — poza limitem planu` : `${item.filename} — kliknij po szczegóły`}
                className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-center transition ${activeItemId === item.id
                  ? 'border-cyan-400 bg-cyan-950/35 ring-2 ring-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.25)]'
                  : selectedIds.has(item.id)
                    ? 'border-rose-400 bg-rose-950/20'
                    : item.locked
                      ? 'border-amber-500/35 bg-slate-900/75 opacity-80'
                      : 'border-slate-700 bg-[#1e293b] hover:border-cyan-500/60'
                  }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleSelect(item.id)}
                  aria-label={`Zaznacz ${item.filename}`}
                  className="absolute right-2 top-2 h-4 w-4 cursor-pointer accent-rose-500"
                />
                <MailAttachmentThumb item={item} apiUrl={apiUrl} fetcher={fetcher} onClick={() => { setActiveItemId(item.id); setDetailItem(item); }} />
                <p className="line-clamp-2 w-full break-all text-[11px] font-semibold text-slate-200">{item.filename}</p>
              </div>
            ))}
          </div>
        ) : (
          pagedItems.map(item => (
            <div
              key={item.id}
              draggable={!item.locked && busyId !== item.id}
              onDragStart={e => e.dataTransfer.setData('text/mail-item-id', item.id)}
              onClick={() => setActiveItemId(item.id)}
              className={`relative flex flex-col gap-3 rounded-xl border p-4 transition ${activeItemId === item.id
                ? 'border-cyan-400 bg-cyan-950/35 ring-2 ring-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.25)]'
                : selectedIds.has(item.id)
                  ? 'border-rose-400 bg-rose-950/20'
                  : item.locked
                    ? 'border-amber-500/35 bg-slate-900/75 opacity-85'
                    : 'border-slate-700 bg-[#1e293b] hover:border-cyan-500/60'
                }`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} aria-label={`Zaznacz ${item.filename}`} className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-rose-500" />
                <MailAttachmentThumb item={item} apiUrl={apiUrl} fetcher={fetcher} onClick={() => { if (!item.locked) { setActiveItemId(item.id); void onPreview(item); } }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-sm font-bold text-white">⋮⋮ {item.filename}</p>
                    {item.locked && (
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        🔒 Poza limitem planu
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 break-words text-xs text-slate-400">{item.from} · {item.subject}</p>
                  <p className="mt-1 break-words text-xs text-cyan-300">{item.detectedLabel} · {(item.size / 1024).toFixed(0)} KB · <span className="text-slate-400">{item.reason}</span></p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-700/60 pt-2.5">
                <button
                  type="button"
                  disabled={Boolean(item.locked)}
                  title={item.locked ? 'Poza limitem planu — przejdź na Standard lub Premium, aby odblokować podgląd' : undefined}
                  onClick={() => { setActiveItemId(item.id); void onPreview(item); }}
                  className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {item.locked ? '🔒 Podgląd zablokowany' : '👁️ Podgląd'}
                </button>
                <FolderSearchPicker
                  folders={sortedFolders}
                  value={folderOverrides[item.id] ?? item.suggestedFolderId ?? ''}
                  disabled={Boolean(item.locked) || busyId === item.id}
                  onChange={fId => setFolderOverrides(prev => ({ ...prev, [item.id]: fId }))}
                />
                <button
                  type="button"
                  disabled={Boolean(item.locked) || busyId === item.id || !canAssign || !(folderOverrides[item.id] ?? item.suggestedFolderId)}
                  title={item.locked ? 'Poza limitem planu — przejdź na Standard lub Premium' : !canAssign ? 'Przenoszenie wymaga planu Standard lub Premium' : undefined}
                  onClick={() => {
                    const targetId = folderOverrides[item.id] ?? item.suggestedFolderId;
                    if (!targetId) return;
                    if (selectedIds.has(item.id) && selectedIds.size > 1) {
                      void onAssignBulk([...selectedIds], targetId).then(() => setSelectedIds(new Set()));
                    } else {
                      void onAssign(item.id, targetId);
                    }
                  }}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  {selectedIds.has(item.id) && selectedIds.size > 1 ? `✓ Zatwierdź (${selectedIds.size})` : '✓ Zatwierdź'}
                </button>
                {(item.fromEmail || item.from.includes('@')) && (
                  <button
                    type="button"
                    disabled={Boolean(item.locked) || busyId === item.id}
                    title={item.locked ? 'Poza limitem planu — przejdź na Standard lub Premium' : undefined}
                    onClick={() => void onExcludeSender(item.fromEmail || item.from, true)}
                    className="rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-xs text-amber-300 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    🚫 Wyklucz nadawcę
                  </button>
                )}
                <button type="button" disabled={busyId === item.id} onClick={() => void onDiscard(item.id)} className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950/40">Odrzuć</button>
              </div>
            </div>
          ))
        )}

        {visibleItems.length > pageSize && (
          <MailPendingPaginationBar
            page={safePage} totalPages={totalPages} pageSize={pageSize} totalItems={visibleItems.length}
            selectedCount={selectedIds.size} assignedSelectedCount={assignedSelectedPairs.length}
            allPageSelected={allPageSelected} allFilteredSelected={allFilteredSelected}
            canAssign={canAssign} folders={sortedFolders} bulkFolderId={bulkFolderId} busy={busyId === 'bulk'}
            onPageChange={setPage}
            onPageSizeChange={size => { setPageSize(size); setPage(1); }}
            onToggleSelectPage={toggleSelectPage}
            onToggleSelectAll={toggleSelectAll}
            onClearSelection={() => setSelectedIds(new Set())}
            onBulkFolderChange={setBulkFolderId}
            onApproveAssignedSelected={handleApproveAssignedSelected}
            onAssignSelected={handleBulkAssign}
            onDiscardSelected={handleBulkDiscard}
          />
        )}
      </div>

      <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {canAssign ? 'Upuść na kartotekę (Drag & Drop)' : 'Przenoszenie zablokowane (Plan Darmowy)'}
        </h3>
        <ScrollFadeContainer innerClassName={`max-h-[75vh] space-y-1.5 pr-1 ${!canAssign ? 'opacity-50' : ''}`}>
          {visibleDropFolders.map(({ folder, depth, pathLabel }) => {
            const hasChildren = parentIdsWithChildren.has(folder.id);
            const isExpanded = expandedDropFolders.has(folder.id);
            return (
              <div
                key={folder.id}
                title={pathLabel}
                onDragOver={e => {
                  if (!canAssign) return;
                  e.preventDefault();
                  setDragOverFolderId(folder.id);
                  scheduleDragExpand(folder.id);
                }}
                onDragLeave={() => {
                  setDragOverFolderId(prev => (prev === folder.id ? null : prev));
                  if (dragHoverExpandRef.current?.folderId === folder.id) clearDragExpandTimer();
                }}
                onDrop={e => {
                  if (!canAssign) return;
                  e.preventDefault();
                  setDragOverFolderId(null);
                  clearDragExpandTimer();
                  const id = e.dataTransfer.getData('text/mail-item-id');
                  if (!id) return;
                  if (selectedIds.has(id) && selectedIds.size > 1) {
                    void onAssignBulk([...selectedIds], folder.id).then(() => setSelectedIds(new Set()));
                  } else {
                    void onAssign(id, folder.id);
                  }
                }}
                style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 18}px` } : undefined}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${dragOverFolderId === folder.id
                  ? 'border-cyan-400 bg-cyan-500/20 text-white'
                  : depth > 0
                    ? 'border-slate-700/70 border-l-2 border-l-cyan-500/50 bg-slate-900/75 text-slate-300'
                    : 'border-slate-700 bg-[#1e293b] text-slate-100'
                  }`}
              >
                <span className="min-w-0 truncate">
                  {depth > 0 ? '↳ 📁 ' : '📂 '}
                  {folder.name}
                </span>
                {hasChildren && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); toggleDropFolder(folder.id); }}
                    aria-label={isExpanded ? `Zwiń podkartoteki ${folder.name}` : `Rozwiń podkartoteki ${folder.name}`}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-700/70 hover:text-cyan-200"
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                )}
              </div>
            );
          })}
        </ScrollFadeContainer>
      </aside>

      {detailItem && (
        <MailPendingItemDetailModal
          item={detailItem} apiUrl={apiUrl} fetcher={fetcher} busy={busyId === detailItem.id} canAssign={canAssign}
          onClose={() => setDetailItem(null)} onPreview={onPreview} onAssign={onAssign} onExcludeSender={onExcludeSender} onDiscard={onDiscard}
        />
      )}
    </div>
  );
}
