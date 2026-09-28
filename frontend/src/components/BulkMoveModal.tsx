import { useState, type ReactNode } from 'react';

type BulkMoveModalProps = {
  isOpen: boolean;
  documentCount: number;
  folderOptions: ReactNode;
  onMove: (folderId: number) => void;
  onClose: () => void;
};

export default function BulkMoveModal({
  isOpen,
  documentCount,
  folderOptions,
  onMove,
  onClose,
}: BulkMoveModalProps) {
  const [folderId, setFolderId] = useState('');
  if (!isOpen) return null;

  const close = () => {
    setFolderId('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#1e293b] p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">Przenieś zaznaczone dokumenty</h3>
        <p className="mt-2 text-sm text-slate-400">Wybrano: {documentCount} dokumentów.</p>
        <select
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          className="mt-5 w-full rounded-md border border-slate-600 bg-[#0f172a] px-3 py-3 text-white outline-none focus:border-blue-500"
          aria-label="Podkartoteka docelowa"
        >
          <option value="">— wybierz podkartotekę —</option>
          {folderOptions}
        </select>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={close} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button>
          <button
            disabled={!folderId}
            onClick={() => { onMove(Number(folderId)); close(); }}
            className="rounded bg-blue-600 px-5 py-2 font-medium text-white shadow-lg hover:bg-blue-500 disabled:opacity-50"
          >
            Przenieś
          </button>
        </div>
      </div>
    </div>
  );
}
