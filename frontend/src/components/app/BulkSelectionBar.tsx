import type { DocumentRecord } from '../../types/domain';

type Props = {
  activeView: string;
  documents: DocumentRecord[];
  selectedDocs: number[];
  onOpenBulkMove: () => void;
  onBulkArchive: () => void;
  onBulkDelete: () => void;
  onBulkTrash: () => void;
  onClearSelected: () => void;
};

/** Floating bottom action bar for bulk document operations. */
export function BulkSelectionBar({
  activeView, documents, selectedDocs,
  onOpenBulkMove, onBulkArchive, onBulkDelete, onBulkTrash, onClearSelected,
}: Props) {
  if (selectedDocs.length === 0) return null;
  const hasReadOnlySelected = documents.some(d => selectedDocs.includes(d.id) && d.readOnly);

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100vw-1.5rem)] max-w-3xl -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-xl border border-slate-600 bg-[#0f172a]/95 px-3 py-2 shadow-2xl backdrop-blur sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5">
      <span className="mr-1 text-xs font-bold text-slate-300">Zaznaczono: {selectedDocs.length}</span>
      <button
        type="button"
        disabled={hasReadOnlySelected && (activeView === 'trash' || activeView === 'archive')}
        onClick={onOpenBulkMove}
        className="rounded-lg border border-indigo-500/70 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-40"
      >
        {activeView === 'trash' || activeView === 'archive' ? 'Przywróć do kartoteki' : 'Przenieś'}
      </button>
      {activeView !== 'trash' && activeView !== 'archive' && (
        <button type="button" onClick={onBulkArchive} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500">
          Archiwizuj
        </button>
      )}
      {activeView === 'trash' ? (
        <button type="button" onClick={onBulkDelete} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500">
          Usuń trwale
        </button>
      ) : (
        <button type="button" onClick={onBulkTrash} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500">
          Do kosza
        </button>
      )}
      <button type="button" onClick={onClearSelected} className="rounded-lg border border-slate-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
        Odznacz
      </button>
    </div>
  );
}
