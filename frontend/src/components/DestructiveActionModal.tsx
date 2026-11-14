type ActionType = 'trash_doc' | 'delete_doc' | 'delete_folder' | 'empty_trash';

export type PendingAction = {
  type: ActionType;
  id: number;
  name: string;
  transferFolderId?: number | null;
  archivedCount?: number;
  trashedCount?: number;
};

type DestructiveActionModalProps = {
  action: PendingAction | null;
  seconds: number | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function actionDescription(action: PendingAction) {
  if (action.type === 'delete_folder') {
    return <>Czy na pewno usunąć kartotekę <strong className="rounded bg-slate-800 px-2 py-1 text-white">{action.name}</strong>? {action.transferFolderId ? 'Dokumenty zostaną przeniesione do wybranej podkartoteki.' : (action.archivedCount || action.trashedCount) ? `W archiwum pozostanie ${action.archivedCount || 0}, a w koszu ${action.trashedCount || 0} dokumentów. Przy przywracaniu wybierzesz podkartotekę docelową.` : 'Kartoteka jest pusta i zostanie usunięta.'}</>;
  }
  if (action.type === 'empty_trash') return <>Czy na pewno <strong className="text-red-400">trwale usunąć wszystkie dokumenty z kosza ({action.name})</strong>? Nie będzie można ich przywrócić z kosza.</>;
  if (action.type === 'delete_doc') {
    return <>Czy na pewno <strong className="text-red-400">TRWALE</strong> usunąć plik <strong className="rounded bg-slate-800 px-2 py-1 text-white">{action.name}</strong>?</>;
  }
  return <>Przenieść dokument <strong className="rounded bg-slate-800 px-2 py-1 text-white">{action.name}</strong> do kosza?</>;
}

export default function DestructiveActionModal({
  action,
  seconds,
  onCancel,
  onConfirm,
}: DestructiveActionModalProps) {
  if (!action || seconds === null) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-md flex-col items-center rounded-2xl border-2 border-red-500/50 bg-[#0f172a] p-8 text-center">
        <div className="mb-4 text-6xl text-red-500 animate-bounce">⚠️</div>
        <h3 className="mb-2 text-2xl font-bold uppercase text-white">Uwaga!</h3>
        <p className="mb-6 text-sm text-slate-300">{actionDescription(action)}</p>
        <div className="flex w-full gap-4">
          <button onClick={onCancel} className="flex-1 rounded-lg bg-slate-700 py-3 font-bold text-white shadow-lg hover:bg-slate-600">Anuluj</button>
          <button onClick={onConfirm} disabled={seconds > 0} className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white shadow-[0_0_15px_rgba(239,68,68,0.5)] hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none">{seconds > 0 ? `Poczekaj ${seconds} s` : action.type === 'trash_doc' ? 'Przenieś do kosza' : 'Potwierdź usunięcie'}</button>
        </div>
      </div>
    </div>
  );
}
