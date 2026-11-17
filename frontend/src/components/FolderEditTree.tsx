import { AppFolderIcon } from './FolderIconPicker';
import { sortedChildren } from '../utils/folderTree';
import type { DocumentRecord, FolderRecord } from '../types/domain';

type Props = {
  folders: FolderRecord[];
  documents: DocumentRecord[];
  isEditingFolders: boolean;
  expandedFolders: number[];
  addingSubfolderTo: number | 'root' | null;
  setAddingSubfolderTo: (target: number | 'root' | null) => void;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  renamingFolderId: number | null;
  setRenamingFolderId: (id: number | null) => void;
  renamingFolderName: string;
  setRenamingFolderName: (name: string) => void;
  onToggleExpand: (id: number) => void;
  onExpandFolder: (id: number) => void;
  onOpenFolder: (id: number) => void;
  onCreateFolder: (parentId: number | null) => void;
  onRenameFolder: (id: number) => void;
  onRequestDeleteFolder: (id: number, name: string) => void;
};

/** Editable hierarchical folder tree rendered when "Edytuj kartoteki" mode is active. */
export default function FolderEditTree({
  folders, documents, isEditingFolders, expandedFolders, addingSubfolderTo, setAddingSubfolderTo,
  newFolderName, setNewFolderName, renamingFolderId, setRenamingFolderId, renamingFolderName, setRenamingFolderName,
  onToggleExpand, onExpandFolder, onOpenFolder, onCreateFolder, onRenameFolder, onRequestDeleteFolder,
}: Props) {
  const getSortedChildren = (parentId: number | null) => sortedChildren(folders, parentId);

  const countDescendants = (id: number): { folders: number; documents: number } => {
    const descendants = getSortedChildren(id);
    return descendants.reduce(
      (total, child) => {
        const nested = countDescendants(child.id);
        return { folders: total.folders + 1 + nested.folders, documents: total.documents + (child._count?.documents ?? 0) + nested.documents };
      },
      { folders: 0, documents: 0 },
    );
  };

  const branchIds = (id: number): number[] => [id, ...getSortedChildren(id).flatMap(child => branchIds(child.id))];

  const renderFolder = (folder: FolderRecord, depth = 0): React.ReactNode => {
    const children = getSortedChildren(folder.id);
    const isExpanded = expandedFolders.includes(folder.id);
    const hasChildren = children.length > 0;
    const totals = depth === 0 ? countDescendants(folder.id) : null;
    const ids = new Set(branchIds(folder.id));
    const hidden = documents.filter(doc => ids.has(doc.folderId));
    const trashCount = hidden.filter(doc => doc.isDeleted).length;
    const archiveCount = hidden.filter(doc => doc.isArchived && !doc.isDeleted).length;
    const openFolder = () => {
      if (hasChildren) { onToggleExpand(folder.id); return; }
      onOpenFolder(folder.id);
    };

    return (
      <div key={folder.id} className={depth ? 'ml-7 border-l border-slate-700 pl-4' : ''}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={openFolder} className="flex flex-1 items-center gap-4 rounded-lg border border-slate-700 bg-[#1e293b] px-5 py-4 text-left transition-all hover:border-blue-500 hover:bg-[#263449]">
            <span className="flex items-center"><AppFolderIcon size="md" /></span>
            <span className="flex-1">
              {renamingFolderId === folder.id ? (
                <input autoFocus value={renamingFolderName} onClick={e => e.stopPropagation()} onChange={e => setRenamingFolderName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onRenameFolder(folder.id); if (e.key === 'Escape') setRenamingFolderId(null); }} className="w-full rounded border border-blue-500 bg-[#111827] px-2 py-1 text-lg font-bold text-white" />
              ) : (
                <span className="block text-lg font-bold text-white">{folder.name}</span>
              )}
              <span className="mt-1 block text-sm text-blue-300">
                {totals
                  ? `${totals.folders} podkartotek · ${totals.documents + (folder._count?.documents ?? 0)} aktywnych dokumentów`
                  : hasChildren
                    ? `${children.length} podkartotek · ${folder._count?.documents ?? 0} dokumentów`
                    : `${folder._count?.documents ?? 0} aktywnych dokumentów`}
                {trashCount > 0 && ` · ${trashCount} w koszu`}
                {archiveCount > 0 && ` · ${archiveCount} w archiwum`}
              </span>
            </span>
            <span className="text-xl text-slate-400">{hasChildren ? (isExpanded ? '⌄' : '›') : '›'}</span>
          </button>
          {hasChildren && Boolean(folder._count?.documents) && (
            <button type="button" onClick={() => onOpenFolder(folder.id)} className="rounded border border-blue-500/60 px-3 py-2 text-xs text-blue-200 hover:bg-blue-500/10">
              Pokaż dokumenty ({folder._count?.documents})
            </button>
          )}
          {isEditingFolders && (
            <div className="flex gap-1">
              <button type="button" onClick={() => { setAddingSubfolderTo(folder.id); setNewFolderName(''); onExpandFolder(folder.id); }} className="p-2 text-blue-300 hover:text-white" title="Dodaj podkartotekę">＋</button>
              <button type="button" onClick={() => { setRenamingFolderId(folder.id); setRenamingFolderName(folder.name); }} className="p-2 text-amber-300 hover:text-white" title="Zmień nazwę">✎</button>
              <button type="button" onClick={() => onRequestDeleteFolder(folder.id, folder.name)} className="p-2 text-red-300 hover:text-white" title="Usuń">🗑</button>
            </div>
          )}
        </div>
        {isEditingFolders && addingSubfolderTo === folder.id && (
          <div className="mt-2 flex gap-2">
            <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && onCreateFolder(folder.id)} placeholder="Nazwa podkartoteki" className="flex-1 rounded border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-white" />
            <button type="button" onClick={() => onCreateFolder(folder.id)} className="rounded bg-blue-600 px-3 text-sm font-bold text-white">Dodaj</button>
            <button type="button" onClick={() => setAddingSubfolderTo(null)} className="px-2 text-slate-400">×</button>
          </div>
        )}
        {hasChildren && isExpanded && <div className="mt-2 space-y-2">{children.map(child => renderFolder(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="max-w-4xl space-y-3">
      {isEditingFolders && (
        <div className="rounded-lg border border-dashed border-slate-500 p-3">
          <p className="mb-2 text-sm font-semibold text-slate-300">Dodaj kartotekę główną</p>
          {addingSubfolderTo === 'root' ? (
            <div className="flex gap-2">
              <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key === 'Enter' && onCreateFolder(null)} placeholder="Nazwa kartoteki" className="flex-1 rounded border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-white" />
              <button type="button" onClick={() => onCreateFolder(null)} className="rounded bg-blue-600 px-3 text-sm font-bold text-white">Dodaj</button>
              <button type="button" onClick={() => setAddingSubfolderTo(null)} className="px-2 text-slate-400">×</button>
            </div>
          ) : (
            <button type="button" onClick={() => { setAddingSubfolderTo('root'); setNewFolderName(''); }} className="text-sm text-blue-300 hover:text-white">
              ＋ Dodaj kartotekę główną
            </button>
          )}
        </div>
      )}
      {getSortedChildren(null).map(folder => renderFolder(folder))}
    </div>
  );
}
