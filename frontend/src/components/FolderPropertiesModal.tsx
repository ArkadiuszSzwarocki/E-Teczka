import type { DocumentRecord, FolderRecord } from '../types/domain';
import { formatBytes } from '../services/documentUpload';
import { FolderIconView } from './FolderIconPicker';

type Props = {
  folder: FolderRecord;
  folders: FolderRecord[];
  documents: DocumentRecord[];
  icon: string;
  isVault: boolean;
  onClose: () => void;
};

function collectSubtreeIds(rootId: number, folders: FolderRecord[]): Set<number> {
  const result = new Set<number>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId !== null && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        added = true;
      }
    }
  }
  return result;
}

function buildPath(folder: FolderRecord, folders: FolderRecord[]): string {
  const byId = new Map(folders.map(f => [f.id, f]));
  const parts: string[] = [];
  let cursor: FolderRecord | undefined = folder;
  const seen = new Set<number>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return `Kartoteki / ${parts.join(' / ')}`;
}

/** Displays detailed statistics and metadata (creation date, counts, total weight, types, vault status) for a folder. */
export default function FolderPropertiesModal({ folder, folders, documents, icon, isVault, onClose }: Props) {
  const subtreeIds = collectSubtreeIds(folder.id, folders);
  const directSubfolders = folders.filter(f => f.parentId === folder.id).length;
  const totalSubfolders = subtreeIds.size - 1;

  const subtreeDocs = documents.filter(d => subtreeIds.has(d.folderId));
  const activeDocs = subtreeDocs.filter(d => !d.isDeleted && !d.isArchived);
  const archivedDocs = subtreeDocs.filter(d => !d.isDeleted && d.isArchived);
  const trashedDocs = subtreeDocs.filter(d => d.isDeleted);

  const totalBytes = subtreeDocs.reduce((sum, d) => sum + (Number(d.fileSize) || 0), 0);
  const activeBytes = activeDocs.reduce((sum, d) => sum + (Number(d.fileSize) || 0), 0);
  const pdfCount = activeDocs.filter(d => d.mimeType === 'application/pdf').length;
  const imageCount = activeDocs.filter(d => d.mimeType.startsWith('image/')).length;
  const ocrCount = activeDocs.filter(d => Boolean(d.ocrText && d.ocrText.trim())).length;

  const latestDocTime = subtreeDocs.reduce((max, d) => Math.max(max, Date.parse(d.updatedAt || d.createdAt) || 0), 0);
  const createdText = folder.createdAt ? new Date(folder.createdAt).toLocaleString('pl-PL') : 'Brak danych';
  const latestText = latestDocTime > 0 ? new Date(latestDocTime).toLocaleString('pl-PL') : 'Brak dokumentów';

  const rows: Array<[string, string]> = [
    ['Ścieżka', buildPath(folder, folders)],
    ['Data założenia', createdText],
    ['Ostatni dokument / zmiana', latestText],
    ['Podkartoteki', `${directSubfolders} bezpośrednich (łącznie w drzewie: ${totalSubfolders})`],
    ['Dokumenty (aktywne)', `${activeDocs.length} (${formatBytes(activeBytes)})`],
    ['Archiwum / Kosz', `Archiwum: ${archivedDocs.length} · Kosz: ${trashedDocs.length}`],
    ['Łączna waga kartoteki', formatBytes(totalBytes)],
    ['Typy aktywnych plików', `PDF: ${pdfCount} · Obrazy: ${imageCount}`],
    ['Rozpoznany tekst (OCR)', `${ocrCount} z ${activeDocs.length} dokumentów`],
    ['Zabezpieczenie', isVault ? '🔒 Sejf (chroniona PIN / hasłem)' : 'Standardowa kartoteka'],
  ];

  return (
    <div onClick={onClose} className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-props-title"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <FolderIconView icon={icon || '📁'} size="md" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">Właściwości kartoteki</p>
              <h2 id="folder-props-title" className="text-xl font-bold text-white">{folder.name}</h2>
            </div>
          </div>
          <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>

        <dl className="mt-4 divide-y divide-slate-800 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <dt className="text-slate-400">{label}</dt>
              <dd className="text-right font-semibold text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500">
            Zamknij
          </button>
        </div>
      </section>
    </div>
  );
}
