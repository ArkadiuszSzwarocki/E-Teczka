import { useEffect, useState } from 'react';
import type { DocumentRecord } from '../types/domain';

export type ArchiveFolder = { id: string; name: string; parentId: string | null; icon: string; order: number };
export type ArchiveWorkspaceState = {
  viewMode: 'icons' | 'list';
  folders: ArchiveFolder[];
  docFolderMap: Record<string, string | null>;
  docOrder: Record<string, number[]>;
};

const EMPTY_WS: ArchiveWorkspaceState = { viewMode: 'icons', folders: [], docFolderMap: {}, docOrder: {} };

/** Manages virtual archive folders, document ordering, drag-and-drop, and workspace persistence. */
export function useArchiveWorkspace(apiUrl: string, fetcher: typeof fetch, documents: DocumentRecord[]) {
  const [ws, setWs] = useState<ArchiveWorkspaceState>(EMPTY_WS);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [iconPickerId, setIconPickerId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [docMenuId, setDocMenuId] = useState<number | null>(null);
  const [dragItem, setDragItem] = useState<{ kind: 'folder'; id: string } | { kind: 'doc'; id: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ folder: ArchiveFolder; docIds: number[]; subfolderCount: number } | null>(null);

  useEffect(() => {
    const closeMenus = () => { setFolderMenuId(null); setIconPickerId(null); setDocMenuId(null); };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  useEffect(() => {
    let active = true;
    void fetcher(`${apiUrl}/api/archive-workspace`)
      .then(async r => (r.ok ? ((await r.json()) as ArchiveWorkspaceState) : null))
      .then(data => { if (active && data) setWs(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [apiUrl, fetcher]);

  const persist = (next: ArchiveWorkspaceState) => {
    setWs(next);
    void fetcher(`${apiUrl}/api/archive-workspace`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => undefined);
  };

  const breadcrumbs: ArchiveFolder[] = [];
  let cursor = currentFolderId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const found = ws.folders.find(f => f.id === cursor);
    if (!found) break;
    breadcrumbs.unshift(found);
    cursor = found.parentId;
  }

  const visibleFolders = ws.folders.filter(f => f.parentId === currentFolderId).sort((a, b) => a.order - b.order);
  const scopeKey = currentFolderId ?? 'root';
  const folderIdsSet = new Set(ws.folders.map(f => f.id));
  const rawDocs = documents.filter(d => {
    const mapped = ws.docFolderMap[String(d.id)];
    const effective = mapped && folderIdsSet.has(mapped) ? mapped : null;
    return effective === currentFolderId;
  });
  const orderList = ws.docOrder[scopeKey] || [];
  const visibleDocs = [...rawDocs].sort((a, b) => {
    const ia = orderList.indexOf(a.id);
    const ib = orderList.indexOf(b.id);
    if (ia === -1 && ib === -1) return b.id - a.id;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const createFolder = (name: string, icon: string) => {
    persist({
      ...ws,
      folders: [...ws.folders, { id: `af_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, parentId: currentFolderId, icon: icon || '📁', order: visibleFolders.length }],
    });
    setCreating(false);
  };

  const renameFolder = (id: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed) persist({ ...ws, folders: ws.folders.map(f => (f.id === id ? { ...f, name: trimmed } : f)) });
    setRenamingId(null);
  };

  const setFolderIcon = (id: string, icon: string) => {
    persist({ ...ws, folders: ws.folders.map(f => (f.id === id ? { ...f, icon } : f)) });
    setFolderMenuId(null);
    setIconPickerId(null);
  };

  const collectBranchIds = (rootId: string): string[] => {
    const result = [rootId];
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const f of ws.folders) if (f.parentId === cur && !result.includes(f.id)) { result.push(f.id); queue.push(f.id); }
    }
    return result;
  };

  const removeFolderMoveUp = (id: string) => {
    const target = ws.folders.find(f => f.id === id);
    const parent = target?.parentId ?? null;
    const nextFolders = ws.folders.filter(f => f.id !== id).map(f => (f.parentId === id ? { ...f, parentId: parent } : f));
    const nextMap = { ...ws.docFolderMap };
    for (const [docId, fid] of Object.entries(nextMap)) if (fid === id) nextMap[docId] = parent;
    persist({ ...ws, folders: nextFolders, docFolderMap: nextMap });
    setFolderMenuId(null);
    setPendingDelete(null);
  };

  const removeFolderBranch = (id: string) => {
    const branch = new Set(collectBranchIds(id));
    const nextFolders = ws.folders.filter(f => !branch.has(f.id));
    const nextMap = { ...ws.docFolderMap };
    for (const [docId, fid] of Object.entries(nextMap)) if (fid && branch.has(fid)) delete nextMap[docId];
    persist({ ...ws, folders: nextFolders, docFolderMap: nextMap });
    setPendingDelete(null);
  };

  const deleteFolder = (id: string) => {
    const folder = ws.folders.find(f => f.id === id);
    if (!folder) return;
    const branch = new Set(collectBranchIds(id));
    const subfolderCount = branch.size - 1;
    const docIds = documents.filter(d => { const fid = ws.docFolderMap[String(d.id)]; return fid && branch.has(fid); }).map(d => d.id);
    setFolderMenuId(null);
    if (docIds.length === 0 && subfolderCount === 0) return removeFolderMoveUp(id);
    setPendingDelete({ folder, docIds, subfolderCount });
  };

  const dropOnFolder = (targetFolderId: string | null) => {
    if (!dragItem) return;
    if (dragItem.kind === 'doc') {
      persist({ ...ws, docFolderMap: { ...ws.docFolderMap, [String(dragItem.id)]: targetFolderId } });
    } else if (dragItem.id !== targetFolderId) {
      if (targetFolderId === currentFolderId || breadcrumbs.some(b => b.id === targetFolderId)) {
        persist({ ...ws, folders: ws.folders.map(f => (f.id === dragItem.id ? { ...f, parentId: targetFolderId } : f)) });
      } else {
        const siblings = visibleFolders.filter(f => f.id !== dragItem.id);
        const targetIdx = siblings.findIndex(f => f.id === targetFolderId);
        const dragged = ws.folders.find(f => f.id === dragItem.id);
        if (dragged && targetIdx >= 0) {
          siblings.splice(targetIdx, 0, dragged);
          const orderMap = new Map(siblings.map((f, idx) => [f.id, idx]));
          persist({ ...ws, folders: ws.folders.map(f => (orderMap.has(f.id) ? { ...f, order: orderMap.get(f.id)! } : f)) });
        }
      }
    }
    setDragItem(null);
  };

  const dropOnDoc = (targetDocId: number) => {
    if (!dragItem || dragItem.kind !== 'doc' || dragItem.id === targetDocId) return setDragItem(null);
    const ids = visibleDocs.map(d => d.id).filter(id => id !== dragItem.id);
    const idx = ids.indexOf(targetDocId);
    ids.splice(idx >= 0 ? idx : ids.length, 0, dragItem.id);
    persist({ ...ws, docOrder: { ...ws.docOrder, [scopeKey]: ids } });
    setDragItem(null);
  };

  const toggleViewMode = () => persist({ ...ws, viewMode: ws.viewMode === 'icons' ? 'list' : 'icons' });

  return {
    ws, currentFolderId, setCurrentFolderId, creating, setCreating,
    folderMenuId, setFolderMenuId, iconPickerId, setIconPickerId,
    renamingId, setRenamingId, renameValue, setRenameValue,
    docMenuId, setDocMenuId, setDragItem, pendingDelete, setPendingDelete,
    breadcrumbs, visibleFolders, visibleDocs,
    createFolder, renameFolder, setFolderIcon, deleteFolder,
    removeFolderMoveUp, removeFolderBranch, dropOnFolder, dropOnDoc, toggleViewMode,
  };
}
