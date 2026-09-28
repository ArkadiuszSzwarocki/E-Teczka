import { useState, type ReactNode } from 'react';

type MoveDocumentModalProps = {
  documentId: number | null;
  folderOptions: ReactNode;
  onMove: (folderId: number) => void;
  onClose: () => void;
};

export default function MoveDocumentModal({
  documentId,
  folderOptions,
  onMove,
  onClose,
}: MoveDocumentModalProps) {
  const [folderId, setFolderId] = useState('');

  if (documentId === null) return null;

  const close = () => {
    setFolderId('');
    onClose();
  };

  const move = () => {
    if (!folderId) return;
    onMove(Number(folderId));
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-[#1e293b] p-6 shadow-2xl">
        <h3 className="mb-4 text-lg font-bold text-white">Przenieś dokument</h3>
        <select
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          className="mb-4 w-full rounded border border-slate-600 bg-[#0f172a] px-3 py-2 text-white outline-none focus:border-blue-500"
          aria-label="Kartoteka docelowa"
        >
          <option value="">— wybierz podkartotekę —</option>
          {folderOptions}
        </select>
        <div className="flex justify-end gap-3">
          <button onClick={close} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
          <button
            disabled={!folderId}
            onClick={move}
            className="rounded bg-blue-600 px-5 py-2 font-medium text-white shadow-lg hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Przenieś
          </button>
        </div>
      </div>
    </div>
  );
}
