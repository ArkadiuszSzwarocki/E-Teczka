import type { Tag } from '../types/domain';
import { DEFAULT_DOC_FILTER, type DocFilterState, type DocSortField, type RetentionFilter, type TypeFilter } from '../utils/documentFilterSort';

type Props = {
  docFilter: DocFilterState;
  setDocFilter: React.Dispatch<React.SetStateAction<DocFilterState>>;
  availableTags: Tag[];
  hasActiveFilter: boolean;
};

/** Sorting and filtering toolbar for documents inside an open folder. */
export default function FoldersFilterBar({ docFilter, setDocFilter, availableTags, hasActiveFilter }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700/80 bg-[#111827]/80 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-400">Sortuj:</span>
      <select value={docFilter.sortBy} onChange={e => setDocFilter(prev => ({ ...prev, sortBy: e.target.value as DocSortField }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200">
        <option value="createdAt">Data dodania</option>
        <option value="name">Nazwa</option>
        <option value="size">Wielkość</option>
        <option value="retention">Czas życia</option>
      </select>
      <button type="button" onClick={() => setDocFilter(prev => ({ ...prev, sortDir: prev.sortDir === 'asc' ? 'desc' : 'asc' }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 font-semibold text-slate-200 hover:bg-slate-800">
        {docFilter.sortDir === 'asc' ? '↑ Rosnąco' : '↓ Malejąco'}
      </button>
      <span className="ml-2 font-semibold text-slate-400">Filtry:</span>
      <select value={docFilter.typeFilter} onChange={e => setDocFilter(prev => ({ ...prev, typeFilter: e.target.value as TypeFilter }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200">
        <option value="all">Wszystkie typy</option>
        <option value="pdf">PDF</option>
        <option value="image">Obrazy</option>
      </select>
      <select value={docFilter.retentionFilter} onChange={e => setDocFilter(prev => ({ ...prev, retentionFilter: e.target.value as RetentionFilter }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200">
        <option value="all">Każdy czas życia</option>
        <option value="active">Z terminem życia</option>
        <option value="indefinite">Bezterminowo</option>
        <option value="expired">Wygasłe</option>
        <option value="range">Według daty…</option>
      </select>
      {docFilter.retentionFilter === 'range' && (
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">od</span>
          <input type="date" aria-label="Termin życia od" value={docFilter.retentionFrom} onChange={e => setDocFilter(prev => ({ ...prev, retentionFrom: e.target.value }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200" />
          <span className="text-slate-400">do</span>
          <input type="date" aria-label="Termin życia do" value={docFilter.retentionTo} onChange={e => setDocFilter(prev => ({ ...prev, retentionTo: e.target.value }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200" />
        </div>
      )}
      {availableTags.length > 0 && (
        <select value={docFilter.tagId} onChange={e => setDocFilter(prev => ({ ...prev, tagId: e.target.value }))} className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200">
          <option value="">Wszystkie tagi</option>
          {availableTags.map(tag => <option key={tag.id} value={String(tag.id)}>{tag.name}</option>)}
        </select>
      )}
      {hasActiveFilter && (
        <button type="button" onClick={() => setDocFilter(prev => ({ ...DEFAULT_DOC_FILTER, sortBy: prev.sortBy, sortDir: prev.sortDir }))} className="rounded border border-slate-600 px-2 py-1 text-amber-300 hover:bg-slate-800">
          Wyczyść filtry
        </button>
      )}
    </div>
  );
}
