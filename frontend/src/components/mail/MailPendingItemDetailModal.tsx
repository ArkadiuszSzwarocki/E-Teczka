import type { MailItem } from '../../types/mailInbox';
import { MailAttachmentThumb } from './MailAttachmentThumb';

type Props = {
  item: MailItem;
  apiUrl: string;
  fetcher: typeof fetch;
  busy: boolean;
  canAssign: boolean;
  onClose: () => void;
  onPreview: (item: MailItem) => Promise<void>;
  onAssign: (itemId: string, folderId: number) => Promise<void>;
  onExcludeSender: (email: string, excluded: boolean) => Promise<void>;
  onDiscard: (itemId: string) => Promise<void>;
};

/** Shows detailed metadata and actions when a compact grid attachment tile is clicked. */
export function MailPendingItemDetailModal({
  item, apiUrl, fetcher, busy, canAssign, onClose, onPreview, onAssign, onExcludeSender, onDiscard,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Szczegóły załącznika ${item.filename}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0f172a] p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <MailAttachmentThumb item={item} apiUrl={apiUrl} fetcher={fetcher} onClick={() => void onPreview(item)} />
            <div className="min-w-0">
              <h4 className="break-words text-sm font-bold text-white">{item.filename}</h4>
              <p className="mt-0.5 text-xs text-cyan-300">{item.detectedLabel} · {(item.size / 1024).toFixed(0)} KB</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
          <p><span className="text-slate-400">Nadawca:</span> {item.from}</p>
          <p><span className="text-slate-400">Temat:</span> {item.subject}</p>
          <p><span className="text-slate-400">Data:</span> {new Date(item.receivedAt).toLocaleString('pl-PL')}</p>
          <p><span className="text-slate-400">Dopasowanie:</span> {item.reason}</p>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={Boolean(item.locked)}
            onClick={() => void onPreview(item)}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {item.locked ? '🔒 Podgląd zablokowany' : '👁️ Podgląd'}
          </button>
          {item.suggestedFolderId && (
            <button
              type="button"
              disabled={Boolean(item.locked) || busy || !canAssign}
              onClick={() => void onAssign(item.id, item.suggestedFolderId!).then(onClose)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              ✓ Zatwierdź → {item.suggestedFolderName}
            </button>
          )}
          {(item.fromEmail || item.from.includes('@')) && (
            <button
              type="button"
              disabled={Boolean(item.locked) || busy}
              title={item.locked ? 'Poza limitem planu — przejdź na Standard lub Premium' : undefined}
              onClick={() => void onExcludeSender(item.fromEmail || item.from, true).then(onClose)}
              className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-950/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              🚫 Wyklucz nadawcę
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDiscard(item.id).then(onClose)}
            className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40"
          >
            🗑️ Usuń i zablokuj
          </button>
        </div>
      </div>
    </div>
  );
}
