import type { ArchiveFolder } from '../hooks/useArchiveWorkspace';

type Props = {
  folder: ArchiveFolder;
  docIds: number[];
  subfolderCount: number;
  onMoveUp: () => void;
  onTrashBranch: () => void;
  onCancel: () => void;
};

/** Confirmation dialog for deleting a non-empty archive folder. */
export default function ArchiveDeleteModal({ folder, docIds, subfolderCount, onMoveUp, onTrashBranch, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/50 bg-[#0f172a] p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">Usuwanie kartoteki „{folder.name}”</h3>
        <p className="mt-2 text-sm text-slate-300">
          W tej kartotece znajduje się <strong className="text-white">{docIds.length}</strong> plików i <strong className="text-white">{subfolderCount}</strong> podkartotek. Co zrobić z plikami?
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          <button type="button" onClick={onMoveUp} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-500">
            Przenieś pliki i podkartoteki poziom wyżej
          </button>
          {docIds.length > 0 && (
            <button type="button" onClick={onTrashBranch} className="w-full rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-500">
              Przenieś cały katalog z plikami do kosza
            </button>
          )}
          <button type="button" onClick={onCancel} className="w-full rounded-lg bg-slate-700 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-600">
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
