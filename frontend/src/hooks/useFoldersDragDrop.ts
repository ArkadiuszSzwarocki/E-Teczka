import { useRef, useState } from 'react';
import type { FolderRecord } from '../types/domain';

type DragItem = { kind: 'folder'; id: number } | { kind: 'doc'; id: number };

type Args = {
  folders: FolderRecord[];
  visibleFolders: FolderRecord[];
  breadcrumbs: FolderRecord[];
  currentFolderId: number | null;
  onReorderFolders: (orderedIds: number[]) => Promise<void>;
  onMoveFolderParent: (id: number, parentId: number | null) => Promise<void>;
  onMoveDocument: (docId: number, folderId: number) => Promise<void>;
};

/** Flicker-free HTML5 drag-and-drop for folder reordering, parent moves, and document filing. */
export function useFoldersDragDrop({
  folders, visibleFolders, breadcrumbs, currentFolderId,
  onReorderFolders, onMoveFolderParent, onMoveDocument,
}: Args) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<number | 'root' | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const foldersContainerRef = useRef<HTMLDivElement>(null);
  const slotRectsRef = useRef<DOMRect[]>([]);

  const displayFolders = (() => {
    if (dragItem?.kind !== 'folder' || dragTargetIndex === null) return visibleFolders;
    const fromIdx = visibleFolders.findIndex(f => f.id === dragItem.id);
    if (fromIdx < 0 || dragTargetIndex < 0 || dragTargetIndex >= visibleFolders.length || fromIdx === dragTargetIndex) {
      return visibleFolders;
    }
    const next = [...visibleFolders];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(dragTargetIndex, 0, moved);
    return next;
  })();

  const resetDrag = () => {
    setDragItem(null);
    setDragOverTarget(null);
    setDragTargetIndex(null);
    slotRectsRef.current = [];
  };

  const dropOnFolder = (targetId: number | null) => {
    if (!dragItem) return;
    if (dragItem.kind === 'doc') {
      if (targetId !== null && folders.some(f => f.id === targetId)) {
        void onMoveDocument(dragItem.id, targetId);
      }
    } else if (dragItem.kind === 'folder') {
      if (targetId === currentFolderId || breadcrumbs.some(b => b.id === targetId)) {
        if (dragItem.id !== targetId) void onMoveFolderParent(dragItem.id, targetId);
      } else if (dragTargetIndex !== null) {
        const fromIdx = visibleFolders.findIndex(f => f.id === dragItem.id);
        if (fromIdx >= 0 && dragTargetIndex !== fromIdx) {
          void onReorderFolders(displayFolders.map(f => f.id));
        }
      }
    }
    resetDrag();
  };

  const startDrag = (e: React.DragEvent<HTMLElement>, item: DragItem) => {
    setDragItem(item);
    setDragOverTarget(null);
    setDragTargetIndex(null);
    if (item.kind === 'folder' && foldersContainerRef.current) {
      const nodes = foldersContainerRef.current.querySelectorAll<HTMLElement>('[data-folder-slot]');
      slotRectsRef.current = Array.from(nodes).map(el => el.getBoundingClientRect());
    } else {
      slotRectsRef.current = [];
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-eteczka-drag', `${item.kind}:${item.id}`);
    e.dataTransfer.setDragImage(e.currentTarget, Math.round(e.currentTarget.clientWidth / 2), 28);
  };

  const handleContainerDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (dragItem?.kind !== 'folder' || slotRectsRef.current.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverTarget !== null) setDragOverTarget(null);
    const x = e.clientX;
    const y = e.clientY;
    let hit = slotRectsRef.current.findIndex(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    if (hit < 0) {
      let bestDist = Infinity;
      slotRectsRef.current.forEach((r, idx) => {
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestDist) { bestDist = d; hit = idx; }
      });
    }
    if (hit >= 0 && hit !== dragTargetIndex) setDragTargetIndex(hit);
  };

  const dragOverTargetProps = (targetId: number | null, isBreadcrumb = false) => ({
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!dragItem) return;
      if (dragItem.kind === 'folder' && !isBreadcrumb) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (isBreadcrumb && dragTargetIndex !== null) setDragTargetIndex(null);
      const key = targetId === null ? 'root' : targetId;
      if (dragOverTarget !== key) setDragOverTarget(key);
    },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => {
      if (dragItem?.kind === 'folder' && !isBreadcrumb) return;
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        const key = targetId === null ? 'root' : targetId;
        if (dragOverTarget === key) setDragOverTarget(null);
      }
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dropOnFolder(targetId);
    },
  });

  return {
    dragItem,
    dragOverTarget,
    dragTargetIndex,
    foldersContainerRef,
    displayFolders,
    startDrag,
    endDrag: resetDrag,
    handleContainerDragOver,
    dragOverTargetProps,
    dropOnFolder,
  };
}
