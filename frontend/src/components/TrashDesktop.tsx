import { useEffect, useState } from 'react';
import type { DocumentRecord } from '../types/domain';
import DocumentThumbnail from './DocumentThumbnail';
import RetentionBadge from './RetentionBadge';
import RodoUnlockBadge from './RodoUnlockBadge';
import DocumentTagCorner, { getTagTileStyle } from './DocumentTagCorner';

const VIEW_KEY = 'eteczka_trash_view_mode_v1';
const ORDER_KEY = 'eteczka_trash_order_v1';

function loadOrder(): number[] {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') as number[]; } catch { return []; }
}

export default function TrashDesktop({
  apiUrl, fetcher, documents, selectedDocs, onToggleSelect, onSelectAllVisible, onClearSelected, onOpenPreview, onHoverEnter, onHoverLeave, onRestore, onDeletePermanently,
}: {
  apiUrl: string; fetcher: typeof fetch; documents: DocumentRecord[]; selectedDocs: number[];
  onToggleSelect: (id: number) => void; onSelectAllVisible: (ids: number[]) => void; onClearSelected: () => void; onOpenPreview: (doc: DocumentRecord) => void;
  onHoverEnter: (doc: DocumentRecord, anchor: HTMLElement) => void; onHoverLeave: () => void;
  onRestore: (doc: DocumentRecord) => void; onDeletePermanently: (doc: DocumentRecord) => void;
}) {
  const [viewMode, setViewMode] = useState<'icons' | 'list'>(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'icons'));
  const [order, setOrder] = useState<number[]>(loadOrder);
  const [docMenuId, setDocMenuId] = useState<number | null>(null);
  const [dragDocId, setDragDocId] = useState<number | null>(null);
  const [activeDocId, setActiveDocId] = useState<number | null>(null);

  useEffect(() => {
    const closeMenus = () => setDocMenuId(null);
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  const toggleView = () => {
    const next = viewMode === 'icons' ? 'list' : 'icons';
    setViewMode(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  const sorted = [...documents].sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia === -1 && ib === -1) return b.id - a.id;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const dropOnDoc = (targetId: number) => {
    if (dragDocId === null || dragDocId === targetId) return setDragDocId(null);
    const ids = sorted.map(d => d.id).filter(id => id !== dragDocId);
    const idx = ids.indexOf(targetId);
    ids.splice(idx >= 0 ? idx : ids.length, 0, dragDocId);
    setOrder(ids);
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    setDragDocId(null);
  };

  const hideThreeDots = selectedDocs.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#111827] px-4 py-3">
        <span className="text-sm font-semibold text-slate-200">🗑️ Kosz ({sorted.length})</span>
        <div className="flex flex-wrap items-center gap-2">
          {sorted.length > 0 && (
            <button type="button" onClick={() => sorted.every(d => selectedDocs.includes(d.id)) ? onClearSelected() : onSelectAllVisible(sorted.map(d => d.id))} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              {sorted.every(d => selectedDocs.includes(d.id)) ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
            </button>
          )}
          <button type="button" onClick={toggleView} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            {viewMode === 'icons' ? '☰ Widok listy' : '⊞ Widok ikon'}
          </button>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-400">
          Kosz jest pusty.
        </div>
      )}

      {viewMode === 'icons' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {sorted.map(doc => {
            const checked = selectedDocs.includes(doc.id);
            const active = activeDocId === doc.id;
            return (
              <div key={doc.id} draggable onDragStart={() => setDragDocId(doc.id)} onDragOver={e => e.preventDefault()} onDrop={() => dropOnDoc(doc.id)} onClick={() => { setActiveDocId(doc.id); onOpenPreview(doc); }} style={getTagTileStyle(doc, checked)} className={`group relative flex cursor-pointer flex-col items-center rounded-xl border p-4 text-center transition ${active ? 'border-cyan-400 bg-cyan-950/35 ring-2 ring-cyan-400 shadow-[0_0_16px_rgba(34,211,238,0.25)]' : checked ? 'border-blue-500 bg-blue-950/30' : 'border-slate-700 bg-[#1e293b] hover:border-slate-500'}`}>
                <input type="checkbox" checked={checked} onClick={e => e.stopPropagation()} onChange={() => onToggleSelect(doc.id)} aria-label={`Zaznacz ${doc.title}`} className="absolute left-2.5 top-2.5 h-4 w-4 accent-blue-500" />
                <DocumentTagCorner document={doc} hideThreeDots={hideThreeDots} />
                {!hideThreeDots && (
                  <button type="button" aria-label="Menu dokumentu" onClick={e => { e.stopPropagation(); setActiveDocId(doc.id); setDocMenuId(docMenuId === doc.id ? null : doc.id); }} className="absolute right-2 top-2 rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white">⋮</button>
                )}
                <button type="button" onClick={e => { e.stopPropagation(); setActiveDocId(doc.id); onOpenPreview(doc); }} onMouseEnter={e => onHoverEnter(doc, e.currentTarget)} onMouseLeave={onHoverLeave} className="mt-3 flex h-16 w-14 items-center justify-center overflow-hidden rounded border border-slate-700 bg-slate-900">
                  <DocumentThumbnail apiUrl={apiUrl} fetcher={fetcher} document={doc} />
                </button>
                <span title={doc.title} onClick={e => { e.stopPropagation(); setActiveDocId(doc.id); onOpenPreview(doc); }} className="mt-2 line-clamp-2 w-full min-w-0 max-w-full break-all cursor-pointer text-xs font-semibold text-slate-200">{doc.title}</span>
                <RetentionBadge document={doc} className="mt-1" />
                <RodoUnlockBadge docId={doc.id} className="mt-1" />
                {doc.readOnly && <span className="mt-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300">Tylko do odczytu</span>}
                {docMenuId === doc.id && !hideThreeDots && (
                  <div onClick={e => e.stopPropagation()} className="absolute right-2 top-9 z-40 w-44 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl">
                    {!doc.readOnly && <button type="button" onClick={() => { onRestore(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Przywróć</button>}
                    <button type="button" onClick={() => { onDeletePermanently(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-red-300 hover:bg-slate-700">Usuń trwale</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-700 bg-[#1e293b]">
          {sorted.map(doc => (
            <div key={doc.id} draggable onDragStart={() => setDragDocId(doc.id)} onDragOver={e => e.preventDefault()} onDrop={() => dropOnDoc(doc.id)} onClick={() => setActiveDocId(doc.id)} className={`relative flex items-center justify-between border-b border-slate-700/60 px-4 py-3 transition ${activeDocId === doc.id ? 'bg-cyan-950/35 ring-1 ring-inset ring-cyan-400' : 'hover:bg-slate-800/60'}`}>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => onToggleSelect(doc.id)} className="h-4 w-4 accent-blue-500" />
                <button type="button" onClick={() => { setActiveDocId(doc.id); onOpenPreview(doc); }} onMouseEnter={e => onHoverEnter(doc, e.currentTarget)} onMouseLeave={onHoverLeave} className="font-medium text-slate-200 hover:text-white">{doc.title}</button>
                <RetentionBadge document={doc} />
                {doc.readOnly && <span className="rounded bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">Tylko do odczytu</span>}
              </div>
              {!hideThreeDots && <button type="button" onClick={e => { e.stopPropagation(); setDocMenuId(docMenuId === doc.id ? null : doc.id); }} className="rounded px-2 py-1 text-lg text-slate-300 hover:bg-slate-700">⋮</button>}
              {docMenuId === doc.id && !hideThreeDots && (
                <div onClick={e => e.stopPropagation()} className="absolute right-4 top-10 z-40 w-44 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl">
                  {!doc.readOnly && <button type="button" onClick={() => { onRestore(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Przywróć</button>}
                  <button type="button" onClick={() => { onDeletePermanently(doc); setDocMenuId(null); }} className="w-full px-3 py-2 text-red-300 hover:bg-slate-700">Usuń trwale</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
