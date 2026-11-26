import { useState } from 'react';
import type { DocumentRecord, FolderRecord } from '../types/domain';
import { formatBytes } from '../services/documentUpload';
import {
  detectRodoMatches,
  getDocumentRodoOverride,
  setDocumentRodoOverride,
  type RodoDocOverride,
} from '../services/rodoProtection';
import { getExpiryDate } from '../utils/documentLifecycle';

type Props = {
  document: DocumentRecord;
  folders?: FolderRecord[];
  onUpdateDocument?: (id: number, patch: { dueDate?: string | null; paymentStatus?: 'paid' | 'unpaid' | null }) => Promise<void>;
  onClose: () => void;
};

function buildFolderPath(folderId: number, folders: FolderRecord[]): string {
  const byId = new Map(folders.map(f => [f.id, f]));
  const parts: string[] = [];
  let cursor = byId.get(folderId);
  const seen = new Set<number>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return parts.length ? `Kartoteki / ${parts.join(' / ')}` : 'Kartoteki';
}

function formatRetention(doc: DocumentRecord): string {
  if (doc.isArchived || doc.retentionEnabled === false) return 'Bez terminu';
  const unit = doc.retentionUnit === 'years' ? 'lat' : doc.retentionUnit === 'months' ? 'mies.' : doc.retentionUnit === 'minutes' ? 'min.' : 'dni';
  const expiry = getExpiryDate(doc);
  return expiry ? `${doc.retentionValue} ${unit} (do ${expiry.toLocaleDateString('pl-PL')})` : `${doc.retentionValue} ${unit}`;
}

/** Displays detailed metadata (size, dates, path, MIME type, retention, OCR, tags, RODO status, owner) for a document. */
export default function DocumentPropertiesModal({ document: doc, folders = [], onUpdateDocument, onClose }: Props) {
  const [rodoMode, setRodoMode] = useState<RodoDocOverride>(() => getDocumentRodoOverride(doc.id));
  const [dueDateInput, setDueDateInput] = useState(() => (doc.dueDate ? new Date(doc.dueDate).toISOString().slice(0, 10) : ''));
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid' | ''>(() => doc.paymentStatus || '');
  const [savingMeta, setSavingMeta] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSaveMeta = async () => {
    if (!onUpdateDocument) return;
    setSavingMeta(true);
    setSavedNotice(false);
    try {
      await onUpdateDocument(doc.id, {
        dueDate: dueDateInput ? new Date(`${dueDateInput}T12:00:00.000Z`).toISOString() : null,
        paymentStatus: paymentStatus === '' ? null : paymentStatus,
      });
      setSavedNotice(true);
    } finally {
      setSavingMeta(false);
    }
  };
  const detectedRodo = detectRodoMatches(`${doc.title}\n${doc.ocrText || ''}`);
  const location = doc.isDeleted
    ? 'Kosz'
    : doc.isArchived
      ? 'Archiwum'
      : buildFolderPath(doc.folderId, folders);

  const statusParts: string[] = [];
  if (doc.isDeleted) statusParts.push('W koszu');
  else if (doc.isArchived) statusParts.push('Zarchiwizowany');
  else statusParts.push('Aktywny');
  if (doc.readOnly) statusParts.push('Tylko do odczytu');

  const tagNames = (doc.tags || []).map(entry => entry.tag.name).join(', ');

  const rows: Array<[string, string]> = [
    ['Lokalizacja', location],
    ['Typ pliku', doc.mimeType || 'Nieznany'],
    ['Rozmiar', typeof doc.fileSize === 'number' ? formatBytes(doc.fileSize) : 'Brak danych'],
    ['Data dodania', new Date(doc.createdAt).toLocaleString('pl-PL')],
    ['Ostatnia zmiana', doc.updatedAt ? new Date(doc.updatedAt).toLocaleString('pl-PL') : 'Brak danych'],
    ['Termin życia', formatRetention(doc)],
    ['Rozpoznany tekst (OCR)', doc.ocrText && doc.ocrText.trim() ? 'Tak' : 'Nie'],
    ['Wykryte dane RODO', detectedRodo.count > 0 ? detectedRodo.labels.join(', ') : 'Brak'],
    ['Tagi', tagNames || 'Brak'],
    ['Wgrywający', doc.user?.name || doc.user?.email || 'Właściciel'],
    ['Status', statusParts.join(' · ')],
  ];

  return (
    <div onClick={onClose} className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-props-title"
        onClick={e => e.stopPropagation()}
        className="custom-scrollbar max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 pb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">Właściwości pliku</p>
            <h2 id="doc-props-title" className="break-words text-xl font-bold text-white">{doc.title}</h2>
          </div>
          <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>

        <dl className="mt-4 divide-y divide-slate-800 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2.5">
              <dt className="shrink-0 font-semibold text-slate-400">{label}</dt>
              <dd className="break-words text-right text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3.5 py-2.5 text-xs">
          <span className="font-semibold text-slate-300">Ochrona RODO tego dokumentu</span>
          <select
            aria-label="Ochrona RODO tego dokumentu"
            value={rodoMode}
            onChange={e => {
              const next = e.target.value as RodoDocOverride;
              setRodoMode(next);
              setDocumentRodoOverride(doc.id, next);
            }}
            className="rounded-lg border border-slate-600 bg-[#111827] px-2.5 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="auto">Automatycznie (wg OCR)</option>
            <option value="always">Zawsze chroń (RODO)</option>
            <option value="never">Bez ochrony</option>
          </select>
        </div>

        {onUpdateDocument && !doc.readOnly && (
          <div className="mt-3 space-y-2.5 rounded-xl border border-slate-700 bg-slate-900/50 p-3.5 text-xs">
            <p className="font-bold text-cyan-300">🗓️ Termin ważności i status płatności</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-slate-400">Termin (polisa, przegląd, płatność)</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={dueDateInput}
                    onChange={e => { setDueDateInput(e.target.value); setSavedNotice(false); }}
                    className="w-full rounded-lg border border-slate-600 bg-[#111827] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                  />
                  {dueDateInput && (
                    <button
                      type="button"
                      onClick={() => { setDueDateInput(''); setSavedNotice(false); }}
                      title="Usuń termin"
                      className="rounded border border-slate-600 px-2 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-slate-400">Status płatności</span>
                <select
                  value={paymentStatus}
                  onChange={e => { setPaymentStatus(e.target.value as 'paid' | 'unpaid' | ''); setSavedNotice(false); }}
                  className="w-full rounded-lg border border-slate-600 bg-[#111827] px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Brak / nie dotyczy</option>
                  <option value="unpaid">Nieopłacone</option>
                  <option value="paid">Opłacone</option>
                </select>
              </label>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-emerald-300">{savedNotice ? '✓ Zapisano zmiany' : ''}</span>
              <button
                type="button"
                disabled={savingMeta}
                onClick={() => void handleSaveMeta()}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {savingMeta ? 'Zapisywanie…' : 'Zapisz termin i status'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-500">Zamknij</button>
        </div>
      </section>
    </div>
  );
}
