import type { ReactNode } from 'react';

type Preview = {
  id: number;
  name: string;
  documentCount: number;
  archivedCount: number;
  trashedCount: number;
};

type Props = {
  preview: Preview;
  transferFolderId: string;
  onTransferFolderChange: (id: string) => void;
  folderOptions: ReactNode[];
  onConfirmTransfer: () => void;
  onConfirmTrash: () => void;
  onCancel: () => void;
};

/** Modal prompting the user whether to move or trash active documents before deleting a folder. */
export default function FolderDeletePreviewModal({
  preview, transferFolderId, onTransferFolderChange, folderOptions,
  onConfirmTransfer, onConfirmTrash, onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/50 bg-[#0f172a] p-7 shadow-2xl">
        <h3 className="text-xl font-bold text-white">Najpierw przenieś dokumenty</h3>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          W kartotece „{preview.name}” i jej podkartotekach jest <strong className="text-white">{preview.documentCount}</strong> aktywnych dokumentów. Wybierz podkartotekę, do której zostaną przeniesione. W archiwum jest {preview.archivedCount}, a w koszu {preview.trashedCount} dokumentów — pozostaną w archiwum i koszu. Przy ich przywracaniu wybierzesz miejsce docelowe.
        </p>
        <select value={transferFolderId} onChange={event => onTransferFolderChange(event.target.value)} className="mt-5 w-full rounded-md border border-slate-600 bg-[#111827] px-3 py-3 text-white focus:border-blue-500 focus:outline-none">
          <option value="">— wybierz podkartotekę docelową —</option>
          {folderOptions}
        </select>
        <div className="mt-6 flex flex-col gap-2.5">
          <button type="button" disabled={!transferFolderId} onClick={onConfirmTransfer} className="w-full rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            Przenieś do wybranej kartoteki i usuń
          </button>
          <button type="button" onClick={onConfirmTrash} className="w-full rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500">
            Przenieś pliki z kartoteki do kosza i usuń
          </button>
          <button type="button" onClick={onCancel} className="w-full rounded-lg bg-slate-700 py-3 font-bold text-white hover:bg-slate-600">
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
