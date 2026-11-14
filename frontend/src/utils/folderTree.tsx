import React from 'react';
import type { FolderRecord } from '../types/domain';

export function sortedChildren(folders: FolderRecord[], parentId: number | null) {
  return folders.filter(folder => folder.parentId === parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function buildFolderOptions(folders: FolderRecord[], parentId: number | null = null, depth = 0): React.ReactElement[] {
  return sortedChildren(folders, parentId).flatMap(child => {
    const spaces = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'.repeat(depth);
    const prefix = `${spaces}${depth > 0 ? '↳ ' : ''}${depth === 0 ? '📂' : '📁'} `;
    return [<option key={child.id} value={child.id} disabled={child.parentId === null} className={depth === 0 ? 'font-bold bg-[#0f172a] text-blue-400' : 'font-medium text-slate-200'}>{prefix}{child.name}</option>, ...buildFolderOptions(folders, child.id, depth + 1)];
  });
}
