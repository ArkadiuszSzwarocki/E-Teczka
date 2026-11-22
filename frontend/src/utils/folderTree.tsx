import React from 'react';
import type { FolderRecord } from '../types/domain';

export function sortedChildren(folders: FolderRecord[], parentId: number | null) {
  return folders.filter(folder => folder.parentId === parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function buildFolderOptions(folders: FolderRecord[], parentId: number | null = null, depth = 0): React.ReactElement[] {
  return sortedChildren(folders, parentId).flatMap(child => {
    const spaces = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'.repeat(depth);
    const prefix = `${spaces}${depth > 0 ? '↳ ' : ''}${depth === 0 ? '📂' : '📁'} `;
    return [<option key={child.id} value={child.id} className={depth === 0 ? 'font-bold bg-[#0f172a] text-blue-400' : 'font-medium text-slate-200'}>{prefix}{child.name}</option>, ...buildFolderOptions(folders, child.id, depth + 1)];
  });
}

/** Counts all nested subfolders and total files inside a folder branch. */
export function countFolderTreeStats<Id extends string | number>(
  folders: Array<{ id: Id; parentId: Id | null }>,
  folderId: Id,
  directFileCount: (id: Id) => number,
): { subfolders: number; files: number } {
  const visited = new Set<Id>([folderId]);
  let subfolders = 0;
  let files = directFileCount(folderId);
  const stack: Id[] = [folderId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of folders) {
      if (child.parentId === current && !visited.has(child.id)) {
        visited.add(child.id);
        subfolders += 1;
        files += directFileCount(child.id);
        stack.push(child.id);
      }
    }
  }
  return { subfolders, files };
}

export type FolderTreeEntry = {
  folder: FolderRecord;
  depth: number;
  pathLabel: string;
};

/** Sorts folders into a pre-order A-Z tree by `parentId` so subfolders appear nested under their parent. */
export function buildFolderTreeEntries(folders: FolderRecord[]): FolderTreeEntry[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const children = new Map<number | null, FolderRecord[]>();

  for (const folder of folders) {
    const parentKey = folder.parentId !== null && byId.has(folder.parentId) ? folder.parentId : null;
    const list = children.get(parentKey) ?? [];
    list.push(folder);
    children.set(parentKey, list);
  }

  for (const list of children.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base', numeric: true }));
  }

  const result: FolderTreeEntry[] = [];
  const visited = new Set<number>();

  const walk = (parentId: number | null, depth: number, prefix: string) => {
    for (const folder of children.get(parentId) ?? []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const pathLabel = prefix ? `${prefix} / ${folder.name}` : folder.name;
      result.push({ folder, depth, pathLabel });
      walk(folder.id, depth + 1, pathLabel);
    }
  };

  walk(null, 0, '');

  for (const folder of folders) {
    if (!visited.has(folder.id)) {
      result.push({ folder, depth: 0, pathLabel: folder.name });
    }
  }

  return result;
}
