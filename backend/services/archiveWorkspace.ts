import fs from 'node:fs';
import path from 'node:path';

export type ArchiveFolder = {
  id: string;
  name: string;
  parentId: string | null;
  icon: string;
  order: number;
};

export type ArchiveWorkspaceState = {
  viewMode: 'icons' | 'list';
  folders: ArchiveFolder[];
  docFolderMap: Record<string, string | null>;
  docOrder: Record<string, number[]>;
};

const DEFAULT_STATE: ArchiveWorkspaceState = {
  viewMode: 'icons',
  folders: [],
  docFolderMap: {},
  docOrder: {},
};

const workspaceFile = (ownerId: number) => path.join(process.cwd(), 'security', `archive-workspace-${ownerId}.json`);

export function validateArchiveWorkspace(value: unknown): ArchiveWorkspaceState {
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowy format układu archiwum.');
  const raw = value as Record<string, unknown>;
  const viewMode = raw.viewMode === 'list' ? 'list' : 'icons';
  const rawFolders = Array.isArray(raw.folders) ? raw.folders : [];
  if (rawFolders.length > 500) throw new Error('Przekroczono maksymalną liczbę folderów archiwum.');

  const folders: ArchiveFolder[] = rawFolders.map((item, idx) => {
    const f = (item || {}) as Record<string, unknown>;
    const id = typeof f.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(f.id) ? f.id : '';
    const name = typeof f.name === 'string' ? f.name.trim().slice(0, 80) : '';
    if (!id || !name) throw new Error('Nieprawidłowy folder archiwum.');
    const parentId = typeof f.parentId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(f.parentId) ? f.parentId : null;
    const rawIcon = typeof f.icon === 'string' ? f.icon.trim() : '';
    const isCustomPng = /^data:image\/png;base64,[A-Za-z0-9+/=]{1,32000}$/.test(rawIcon);
    const icon = isCustomPng || (rawIcon.length > 0 && rawIcon.length <= 8) ? rawIcon : '📁';
    const order = Number.isFinite(Number(f.order)) ? Number(f.order) : idx;
    return { id, name, parentId, icon, order };
  });

  const docFolderMap: Record<string, string | null> = {};
  if (raw.docFolderMap && typeof raw.docFolderMap === 'object' && !Array.isArray(raw.docFolderMap)) {
    for (const [docId, folderId] of Object.entries(raw.docFolderMap as Record<string, unknown>)) {
      if (!/^\d+$/.test(docId)) continue;
      docFolderMap[docId] = typeof folderId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(folderId) ? folderId : null;
    }
  }

  const docOrder: Record<string, number[]> = {};
  if (raw.docOrder && typeof raw.docOrder === 'object' && !Array.isArray(raw.docOrder)) {
    for (const [scope, ids] of Object.entries(raw.docOrder as Record<string, unknown>)) {
      if (!Array.isArray(ids) || scope.length > 64) continue;
      docOrder[scope] = ids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 5000);
    }
  }

  return { viewMode, folders, docFolderMap, docOrder };
}

export function getArchiveWorkspace(ownerId: number): ArchiveWorkspaceState {
  try {
    const raw = JSON.parse(fs.readFileSync(workspaceFile(ownerId), 'utf8'));
    return validateArchiveWorkspace(raw);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveArchiveWorkspace(ownerId: number, value: unknown): ArchiveWorkspaceState {
  const validated = validateArchiveWorkspace(value);
  const dir = path.dirname(workspaceFile(ownerId));
  fs.mkdirSync(dir, { recursive: true });
  const target = workspaceFile(ownerId);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(validated, null, 2), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
  return validated;
}
