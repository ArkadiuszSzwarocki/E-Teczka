import type { DocumentRecord } from '../types/domain';
import DocumentThumbnail from './DocumentThumbnail';
import FolderIconPicker, { AppFolderIcon, FolderIconView } from './FolderIconPicker';
import FolderCreateModal from './FolderCreateModal';
import RetentionBadge from './RetentionBadge';
import DocumentTagCorner, { getTagTileStyle } from './DocumentTagCorner';
import ArchiveDeleteModal from './ArchiveDeleteModal';
import { useArchiveWorkspace } from '../hooks/useArchiveWorkspace';
import { countFolderTreeStats } from '../utils/folderTree';

/** Archive workspace desktop view supporting virtual folders, icon/list modes, and drag-and-drop. */
export default function ArchiveDesktop({
  apiUrl, fetcher, plan, documents, selectedDocs, onToggleSelect, onSelectAllVisible, onClearSelected, onOpenPreview, onHoverEnter, onHoverLeave, onRestore, onTrashDocs, onShareLink, onShareClassic, onOpenOcr, onExportPdf, onPropertiesDoc,
}: {
  apiUrl: string; fetcher: typeof fetch; plan: 'free' | 'standard' | 'premium'; documents: DocumentRecord[]; selectedDocs: number[];
  onToggleSelect: (id: number) => void; onSelectAllVisible: (ids: number[]) => void; onClearSelected: () => void; onOpenPreview: (doc: DocumentRecord) => void;
  onHoverEnter: (doc: DocumentRecord, anchor: HTMLElement) => void; onHoverLeave: () => void;
  onRestore: (doc: DocumentRecord) => void; onTrashDocs: (docIds: number[], onConfirmed: () => void) => void;
  onShareLink: (doc: DocumentRecord) => void; onShareClassic: (doc: DocumentRecord) => void; onOpenOcr: (doc: DocumentRecord) => void; onExportPdf: (doc: DocumentRecord, watermark?: boolean) => void; onPropertiesDoc: (doc: DocumentRecord) => void;
}) {
  const arch = useArchiveWorkspace(apiUrl, fetcher, documents);
  const hideThreeDots = selectedDocs.length > 1;

  const renderDocMenu = (doc: DocumentRecord, posClass: string) => (
    <div onClick={e => e.stopPropagation()} className={`absolute ${posClass} z-40 w-48 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl`}>
      {!doc.readOnly && <button type="button" onClick={() => { onRestore(doc); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Przywróć</button>}
      {!doc.readOnly && <button type="button" onClick={() => { onShareLink(doc); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Bezpieczny link</button>}
      {!doc.readOnly && <button type="button" onClick={() => { onShareClassic(doc); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Udostępnij klasycznie</button>}
      {!doc.readOnly && <button type="button" onClick={() => { onOpenOcr(doc); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-blue-300 hover:bg-slate-700">Rozpoznany tekst (OCR)</button>}
      {!doc.readOnly && <button type="button" onClick={() => { onExportPdf(doc); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-emerald-300 hover:bg-slate-700">Eksportuj do PDF</button>}
      {!doc.readOnly && <button type="button" onClick={() => { onExportPdf(doc, true); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-cyan-300 hover:bg-slate-700">Znak wodny (PDF)</button>}
      <button type="button" onClick={() => { onPropertiesDoc(doc); arch.setDocMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">ℹ️ Właściwości</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#111827] px-4 py-3">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm">
          <button type="button" onClick={() => arch.setCurrentFolderId(null)} onDragOver={e => e.preventDefault()} onDrop={() => arch.dropOnFolder(null)} className={`rounded px-2 py-1 font-semibold ${arch.currentFolderId === null ? 'bg-blue-600/20 text-blue-300' : 'text-slate-300 hover:bg-slate-800'}`}>
            🗄️ Archiwum
          </button>
          {arch.breadcrumbs.map(b => (
            <span key={b.id} className="flex items-center gap-1.5">
              <span className="text-slate-600">/</span>
              <button type="button" onClick={() => arch.setCurrentFolderId(b.id)} onDragOver={e => e.preventDefault()} onDrop={() => arch.dropOnFolder(b.id)} className={`rounded px-2 py-1 font-semibold ${arch.currentFolderId === b.id ? 'bg-blue-600/20 text-blue-300' : 'text-slate-300 hover:bg-slate-800'}`}>
                <FolderIconView icon={b.icon} size="sm" /> {b.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {arch.visibleDocs.length > 0 && (
            <button type="button" onClick={() => arch.visibleDocs.every(d => selectedDocs.includes(d.id)) ? onClearSelected() : onSelectAllVisible(arch.visibleDocs.map(d => d.id))} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              {arch.visibleDocs.every(d => selectedDocs.includes(d.id)) ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
            </button>
          )}
          <button type="button" onClick={() => arch.setCreating(v => !v)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500">
            + {arch.currentFolderId ? 'Nowa podkartoteka' : 'Nowa kartoteka'}
          </button>
          <button type="button" onClick={arch.toggleViewMode} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
            {arch.ws.viewMode === 'icons' ? '☰ Widok listy' : '⊞ Widok ikon'}
          </button>
        </div>
      </div>

      {arch.creating && <FolderCreateModal isSubfolder={arch.currentFolderId !== null} plan={plan} onSubmit={arch.createFolder} onCancel={() => arch.setCreating(false)} />}

      {arch.visibleFolders.length === 0 && arch.visibleDocs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-sm text-slate-400">
          Ten folder archiwum jest pusty. Utwórz kartotekę lub zarchiwizuj dokumenty i przeciągnij je tutaj.
        </div>
      )}

      {arch.ws.viewMode === 'icons' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {arch.visibleFolders.map(folder => {
            const stats = countFolderTreeStats(arch.ws.folders, folder.id, id => documents.filter(d => arch.ws.docFolderMap[String(d.id)] === id).length);
            return (
              <div key={folder.id} draggable onDragStart={() => arch.setDragItem({ kind: 'folder', id: folder.id })} onDragOver={e => e.preventDefault()} onDrop={() => arch.dropOnFolder(folder.id)} onClick={() => { if (arch.renamingId !== folder.id) arch.setCurrentFolderId(folder.id); }} className="group relative flex cursor-pointer flex-col items-center rounded-xl border border-slate-700 bg-[#1e293b] p-4 text-center transition hover:border-blue-400/70 hover:bg-slate-800/80">
                <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-0.5 text-[10px] font-medium text-slate-400">
                  <span title={`Kartoteki wewnątrz: ${stats.subfolders}`} className="inline-flex items-center gap-1"><AppFolderIcon size="xs" /> {stats.subfolders}</span>
                  <span title={`Pliki łącznie: ${stats.files}`}>📄 {stats.files}</span>
                </div>
                {!hideThreeDots && (
                  <button type="button" aria-label="Opcje kartoteki" onClick={e => { e.stopPropagation(); arch.setFolderMenuId(arch.folderMenuId === folder.id ? null : folder.id); arch.setIconPickerId(null); }} className="absolute right-2 top-2 rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white">⋮</button>
                )}
                <div className="mt-1"><FolderIconView icon={folder.icon} /></div>
                {arch.renamingId === folder.id ? (
                  <input autoFocus onClick={e => e.stopPropagation()} value={arch.renameValue} onChange={e => arch.setRenameValue(e.target.value)} onBlur={() => arch.renameFolder(folder.id, arch.renameValue)} onKeyDown={e => { if (e.key === 'Enter') arch.renameFolder(folder.id, arch.renameValue); }} className="mt-2 w-full rounded border border-blue-400 bg-slate-950 px-2 py-1 text-center text-xs text-white" />
                ) : (
                  <span className="mt-2 line-clamp-2 text-sm font-semibold text-slate-100">{folder.name}</span>
                )}
                {arch.folderMenuId === folder.id && !hideThreeDots && (
                  <div onClick={e => e.stopPropagation()} className="absolute right-2 top-9 z-40 w-48 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl">
                    <button type="button" onClick={() => { arch.setCurrentFolderId(folder.id); arch.setFolderMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Otwórz</button>
                    <button type="button" onClick={() => { arch.setRenamingId(folder.id); arch.setRenameValue(folder.name); arch.setFolderMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Zmień nazwę</button>
                    <button type="button" onClick={() => arch.setIconPickerId(arch.iconPickerId === folder.id ? null : folder.id)} className="w-full px-3 py-2 text-blue-300 hover:bg-slate-700">Zmień ikonę</button>
                    {arch.iconPickerId === folder.id && <FolderIconPicker plan={plan} onSelect={ic => arch.setFolderIcon(folder.id, ic)} />}
                    <button type="button" onClick={() => arch.deleteFolder(folder.id)} className="w-full px-3 py-2 text-red-300 hover:bg-slate-700">Usuń kartotekę</button>
                  </div>
                )}
              </div>
            );
          })}

          {arch.visibleDocs.map(doc => {
            const checked = selectedDocs.includes(doc.id);
            return (
              <div key={doc.id} draggable onDragStart={() => arch.setDragItem({ kind: 'doc', id: doc.id })} onDragOver={e => e.preventDefault()} onDrop={() => arch.dropOnDoc(doc.id)} onClick={() => onOpenPreview(doc)} style={getTagTileStyle(doc, checked)} className={`group relative flex cursor-pointer flex-col items-center rounded-xl border p-4 text-center transition ${checked ? 'border-blue-500 bg-blue-950/30' : 'border-slate-700 bg-[#1e293b] hover:border-slate-500'}`}>
                <input type="checkbox" checked={checked} onClick={e => e.stopPropagation()} onChange={() => onToggleSelect(doc.id)} aria-label={`Zaznacz ${doc.title}`} className="absolute left-2.5 top-2.5 h-4 w-4 accent-blue-500" />
                <DocumentTagCorner document={doc} hideThreeDots={hideThreeDots} />
                {!hideThreeDots && (
                  <button type="button" aria-label="Menu dokumentu" onClick={e => { e.stopPropagation(); arch.setDocMenuId(arch.docMenuId === doc.id ? null : doc.id); arch.setFolderMenuId(null); }} className="absolute right-2 top-2 rounded px-2 py-0.5 text-lg text-slate-400 hover:bg-slate-700 hover:text-white">⋮</button>
                )}
                <button type="button" onClick={() => onOpenPreview(doc)} onMouseEnter={e => onHoverEnter(doc, e.currentTarget)} onMouseLeave={onHoverLeave} className="mt-3 flex h-16 w-14 items-center justify-center overflow-hidden rounded border border-slate-700 bg-slate-900">
                  <DocumentThumbnail apiUrl={apiUrl} fetcher={fetcher} document={doc} />
                </button>
                <span onClick={() => onOpenPreview(doc)} className="mt-2 line-clamp-2 cursor-pointer text-xs font-semibold text-slate-200">{doc.title}</span>
                <RetentionBadge document={doc} className="mt-1" />
                {doc.readOnly && <span className="mt-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300">Tylko do odczytu</span>}
                {arch.docMenuId === doc.id && !hideThreeDots && renderDocMenu(doc, 'right-2 top-9')}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-700 bg-[#1e293b]">
          {arch.visibleFolders.map(folder => (
            <div key={folder.id} draggable onDragStart={() => arch.setDragItem({ kind: 'folder', id: folder.id })} onDragOver={e => e.preventDefault()} onDrop={() => arch.dropOnFolder(folder.id)} className="relative flex items-center justify-between border-b border-slate-700/60 px-4 py-3 hover:bg-slate-800/60">
              <button type="button" onClick={() => arch.setCurrentFolderId(folder.id)} className="flex items-center gap-3 text-left font-semibold text-white">
                <FolderIconView icon={folder.icon} size="sm" />
                <span>{folder.name}</span>
              </button>
              {!hideThreeDots && <button type="button" onClick={e => { e.stopPropagation(); arch.setFolderMenuId(arch.folderMenuId === folder.id ? null : folder.id); }} className="rounded px-2 py-1 text-lg text-slate-300 hover:bg-slate-700">⋮</button>}
              {arch.folderMenuId === folder.id && !hideThreeDots && (
                <div onClick={e => e.stopPropagation()} className="absolute right-4 top-10 z-40 w-48 rounded-lg border border-slate-600 bg-[#111827] py-1 text-left text-xs shadow-2xl">
                  <button type="button" onClick={() => { arch.setCurrentFolderId(folder.id); arch.setFolderMenuId(null); }} className="w-full px-3 py-2 text-slate-200 hover:bg-slate-700">Otwórz</button>
                  <button type="button" onClick={() => arch.setIconPickerId(arch.iconPickerId === folder.id ? null : folder.id)} className="w-full px-3 py-2 text-blue-300 hover:bg-slate-700">Zmień ikonę</button>
                  {arch.iconPickerId === folder.id && <FolderIconPicker plan={plan} onSelect={ic => arch.setFolderIcon(folder.id, ic)} />}
                  <button type="button" onClick={() => arch.deleteFolder(folder.id)} className="w-full px-3 py-2 text-red-300 hover:bg-slate-700">Usuń kartotekę</button>
                </div>
              )}
            </div>
          ))}
          {arch.visibleDocs.map(doc => (
            <div key={doc.id} draggable onDragStart={() => arch.setDragItem({ kind: 'doc', id: doc.id })} onDragOver={e => e.preventDefault()} onDrop={() => arch.dropOnDoc(doc.id)} className="relative flex items-center justify-between border-b border-slate-700/60 px-4 py-3 hover:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => onToggleSelect(doc.id)} className="h-4 w-4 accent-blue-500" />
                <button type="button" onClick={() => onOpenPreview(doc)} onMouseEnter={e => onHoverEnter(doc, e.currentTarget)} onMouseLeave={onHoverLeave} className="font-medium text-slate-200 hover:text-white">{doc.title}</button>
                <RetentionBadge document={doc} />
                {doc.readOnly && <span className="rounded bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">Tylko do odczytu</span>}
              </div>
              {!hideThreeDots && <button type="button" onClick={e => { e.stopPropagation(); arch.setDocMenuId(arch.docMenuId === doc.id ? null : doc.id); }} className="rounded px-2 py-1 text-lg text-slate-300 hover:bg-slate-700">⋮</button>}
              {arch.docMenuId === doc.id && !hideThreeDots && renderDocMenu(doc, 'right-4 top-10')}
            </div>
          ))}
        </div>
      )}

      {arch.pendingDelete && (
        <ArchiveDeleteModal
          folder={arch.pendingDelete.folder}
          docIds={arch.pendingDelete.docIds}
          subfolderCount={arch.pendingDelete.subfolderCount}
          onMoveUp={() => arch.removeFolderMoveUp(arch.pendingDelete!.folder.id)}
          onTrashBranch={() => { const d = arch.pendingDelete!; arch.setPendingDelete(null); onTrashDocs(d.docIds, () => arch.removeFolderBranch(d.folder.id)); }}
          onCancel={() => arch.setPendingDelete(null)}
        />
      )}
    </div>
  );
}
