"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateArchiveWorkspace = validateArchiveWorkspace;
exports.getArchiveWorkspace = getArchiveWorkspace;
exports.saveArchiveWorkspace = saveArchiveWorkspace;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_STATE = {
    viewMode: 'icons',
    folders: [],
    docFolderMap: {},
    docOrder: {},
};
const workspaceFile = (ownerId) => node_path_1.default.join(process.cwd(), 'security', `archive-workspace-${ownerId}.json`);
function validateArchiveWorkspace(value) {
    if (!value || typeof value !== 'object')
        throw new Error('Nieprawidłowy format układu archiwum.');
    const raw = value;
    const viewMode = raw.viewMode === 'list' ? 'list' : 'icons';
    const rawFolders = Array.isArray(raw.folders) ? raw.folders : [];
    if (rawFolders.length > 500)
        throw new Error('Przekroczono maksymalną liczbę folderów archiwum.');
    const folders = rawFolders.map((item, idx) => {
        const f = (item || {});
        const id = typeof f.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(f.id) ? f.id : '';
        const name = typeof f.name === 'string' ? f.name.trim().slice(0, 80) : '';
        if (!id || !name)
            throw new Error('Nieprawidłowy folder archiwum.');
        const parentId = typeof f.parentId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(f.parentId) ? f.parentId : null;
        const rawIcon = typeof f.icon === 'string' ? f.icon.trim() : '';
        const isCustomPng = /^data:image\/png;base64,[A-Za-z0-9+/=]{1,32000}$/.test(rawIcon);
        const icon = isCustomPng || (rawIcon.length > 0 && rawIcon.length <= 8) ? rawIcon : '📁';
        const order = Number.isFinite(Number(f.order)) ? Number(f.order) : idx;
        return { id, name, parentId, icon, order };
    });
    const docFolderMap = {};
    if (raw.docFolderMap && typeof raw.docFolderMap === 'object' && !Array.isArray(raw.docFolderMap)) {
        for (const [docId, folderId] of Object.entries(raw.docFolderMap)) {
            if (!/^\d+$/.test(docId))
                continue;
            docFolderMap[docId] = typeof folderId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(folderId) ? folderId : null;
        }
    }
    const docOrder = {};
    if (raw.docOrder && typeof raw.docOrder === 'object' && !Array.isArray(raw.docOrder)) {
        for (const [scope, ids] of Object.entries(raw.docOrder)) {
            if (!Array.isArray(ids) || scope.length > 64)
                continue;
            docOrder[scope] = ids.map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 5000);
        }
    }
    return { viewMode, folders, docFolderMap, docOrder };
}
function getArchiveWorkspace(ownerId) {
    try {
        const raw = JSON.parse(node_fs_1.default.readFileSync(workspaceFile(ownerId), 'utf8'));
        return validateArchiveWorkspace(raw);
    }
    catch (_a) {
        return structuredClone(DEFAULT_STATE);
    }
}
function saveArchiveWorkspace(ownerId, value) {
    const validated = validateArchiveWorkspace(value);
    const dir = node_path_1.default.dirname(workspaceFile(ownerId));
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const target = workspaceFile(ownerId);
    node_fs_1.default.writeFileSync(`${target}.tmp`, JSON.stringify(validated, null, 2), { mode: 0o600 });
    node_fs_1.default.renameSync(`${target}.tmp`, target);
    return validated;
}
