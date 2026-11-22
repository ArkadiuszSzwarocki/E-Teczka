import type { FolderRecord } from '../../types/domain';
import { FolderSearchPicker } from './FolderSearchPicker';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 300, 400, 500] as const;

type Props = {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  selectedCount: number;
  assignedSelectedCount: number;
  allPageSelected: boolean;
  allFilteredSelected: boolean;
  canAssign: boolean;
  folders: FolderRecord[];
  bulkFolderId: number | '';
  busy: boolean;
  onPageChange: (next: number) => void;
  onPageSizeChange: (size: number) => void;
  onToggleSelectPage: () => void;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onBulkFolderChange: (folderId: number | '') => void;
  onApproveAssignedSelected: () => void;
  onAssignSelected: () => void;
  onDiscardSelected: (block?: boolean) => void;
};

/** Compact pagination bar with a contextual bulk-action strip that appears when items are selected. */
export function MailPendingPaginationBar({
  page, totalPages, pageSize, totalItems, selectedCount, assignedSelectedCount, allPageSelected, allFilteredSelected,
  canAssign, folders, bulkFolderId, busy,
  onPageChange, onPageSizeChange, onToggleSelectPage, onToggleSelectAll, onClearSelection,
  onBulkFolderChange, onApproveAssignedSelected, onAssignSelected, onDiscardSelected,
}: Props) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/70 bg-[#1e293b]/60 px-3 py-1.5 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400">Zaznacz:</span>
          <button
            type="button"
            onClick={onToggleSelectPage}
            className={`rounded-md px-2 py-0.5 transition ${allPageSelected ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300 hover:bg-slate-700/70'}`}
          >
            {allPageSelected ? '✓ Strona' : 'Stronę'}
          </button>
          <button
            type="button"
            onClick={onToggleSelectAll}
            className={`rounded-md px-2 py-0.5 transition ${allFilteredSelected ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300 hover:bg-slate-700/70'}`}
          >
            {allFilteredSelected ? `✓ Wszystkie (${totalItems})` : `Wszystkie (${totalItems})`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            aria-label="Liczba załączników na stronie"
            className="rounded-md border border-slate-700 bg-[#0f172a] px-1.5 py-0.5 text-xs text-slate-200"
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size} / str.</option>
            ))}
          </select>
          <span className="text-slate-400">{start}–{end} z {totalItems}</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                aria-label="Poprzednia strona"
                className="rounded-md border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-700 disabled:opacity-35"
              >
                ‹
              </button>
              <span className="px-1 text-slate-300">{page} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                aria-label="Następna strona"
                className="rounded-md border border-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-700 disabled:opacity-35"
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/25 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-cyan-200">Zaznaczono: {selectedCount}</span>
            {assignedSelectedCount > 0 && (
              <button
                type="button"
                disabled={busy || !canAssign}
                title={!canAssign ? 'Przenoszenie wymaga planu Standard lub Premium' : undefined}
                onClick={onApproveAssignedSelected}
                className="rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                ✓ Do przypisanych ({assignedSelectedCount})
              </button>
            )}
            {folders.length > 0 && (
              <>
                <FolderSearchPicker
                  folders={folders}
                  value={bulkFolderId}
                  disabled={!canAssign}
                  placeholder="Inna kartoteka…"
                  placement="bottom"
                  onChange={folderId => onBulkFolderChange(folderId)}
                />
                <button
                  type="button"
                  disabled={busy || !canAssign || !bulkFolderId}
                  title={!canAssign ? 'Przenoszenie wymaga planu Standard lub Premium' : undefined}
                  onClick={onAssignSelected}
                  className="rounded-lg border border-emerald-500/60 bg-emerald-950/60 px-2.5 py-1 font-bold text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-40"
                >
                  📁 Przenieś
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onDiscardSelected(false)}
              title="Usuń zaznaczone z poczekalni bez blokowania ponownego pobrania"
              className="rounded-lg border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 font-semibold text-amber-200 hover:bg-amber-900/50 disabled:opacity-50"
            >
              ✕ Odrzuć ({selectedCount})
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDiscardSelected(true)}
              title="Usuń zaznaczone i zablokuj ich ponowne pobieranie ze skrzynki"
              className="rounded-lg border border-rose-500/50 bg-rose-950/50 px-2.5 py-1 font-semibold text-rose-200 hover:bg-rose-900/60 disabled:opacity-50"
            >
              🗑️ Usuń i zablokuj
            </button>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            ✕ Wyczyść
          </button>
        </div>
      )}
    </div>
  );
}
