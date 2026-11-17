"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFamilySchema = ensureFamilySchema;
exports.getFamilyVisibleOwnerIds = getFamilyVisibleOwnerIds;
exports.getAccessibleFolderIds = getAccessibleFolderIds;
exports.canAccessFolder = canAccessFolder;
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
const folderVault_1 = require("./folderVault");
let schemaReady = null;
const vaultStore = (0, folderVault_1.createFolderVaultStore)(node_path_1.default.join(paths_1.securityDir, 'folder-vault.enc'));
/** Ensures family group, member, and invite tables exist in SQLite. */
function ensureFamilySchema(prisma) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!schemaReady) {
            schemaReady = (() => __awaiter(this, void 0, void 0, function* () {
                yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS FamilyGroup (id INTEGER PRIMARY KEY AUTOINCREMENT, hostUserId INTEGER NOT NULL UNIQUE, createdAt TEXT NOT NULL)');
                yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS FamilyMember (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, userId INTEGER NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT \'member\', status TEXT NOT NULL DEFAULT \'active\', joinedAt TEXT NOT NULL)');
                yield prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS FamilyMember_group_status_idx ON FamilyMember(groupId, status)');
                yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS FamilyInvite (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, email TEXT NOT NULL, code TEXT NOT NULL UNIQUE, createdByUserId INTEGER NOT NULL, expiresAt TEXT NOT NULL, acceptedAt TEXT, createdAt TEXT NOT NULL)');
                yield prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS FamilyInvite_email_idx ON FamilyInvite(email)');
            }))();
        }
        yield schemaReady;
    });
}
/** Returns all active user IDs sharing non-vault folders with the given user. */
function getFamilyVisibleOwnerIds(prisma, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield ensureFamilySchema(prisma);
        const memberships = yield prisma.$queryRaw `
    SELECT groupId FROM FamilyMember WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `;
        const groupId = (_a = memberships[0]) === null || _a === void 0 ? void 0 : _a.groupId;
        if (!groupId)
            return [userId];
        const rows = yield prisma.$queryRaw `
    SELECT userId FROM FamilyMember WHERE groupId = ${groupId} AND status = 'active'
  `;
        const ids = Array.from(new Set(rows.map(row => Number(row.userId)).filter(id => Number.isInteger(id) && id > 0)));
        return ids.includes(userId) ? ids : [userId, ...ids];
    });
}
function isVaultFolder(ownerId, folderId, name) {
    if (name.trim().toLowerCase() === 'sejf')
        return true;
    try {
        return vaultStore.status(`${ownerId}:${folderId}`).configured;
    }
    catch (_a) {
        return false;
    }
}
/**
 * Returns all folder IDs visible to `currentUserId`, including shared family folders
 * while strictly hiding every other user's personal Vault ("Sejf" or vault-locked branch).
 */
function getAccessibleFolderIds(prisma, currentUserId) {
    return __awaiter(this, void 0, void 0, function* () {
        const ownerIds = yield getFamilyVisibleOwnerIds(prisma, currentUserId);
        const folders = yield prisma.folder.findMany({
            where: { ownerId: { in: ownerIds } },
            select: { id: true, name: true, parentId: true, ownerId: true },
        });
        const byId = new Map(folders.map(folder => [folder.id, folder]));
        const hiddenCache = new Map();
        const isHiddenFromUser = (folderId, visited = new Set()) => {
            const cached = hiddenCache.get(folderId);
            if (cached !== undefined)
                return cached;
            if (visited.has(folderId))
                return false;
            visited.add(folderId);
            const folder = byId.get(folderId);
            if (!folder)
                return true;
            if (folder.ownerId === currentUserId) {
                hiddenCache.set(folderId, false);
                return false;
            }
            if (isVaultFolder(folder.ownerId, folder.id, folder.name)) {
                hiddenCache.set(folderId, true);
                return true;
            }
            const parentHidden = folder.parentId !== null && byId.has(folder.parentId)
                ? isHiddenFromUser(folder.parentId, visited)
                : false;
            hiddenCache.set(folderId, parentHidden);
            return parentHidden;
        };
        return folders.filter(folder => !isHiddenFromUser(folder.id)).map(folder => folder.id);
    });
}
/** Checks whether `currentUserId` can collaborate on `folderId` (respecting private Vault isolation). */
function canAccessFolder(prisma, currentUserId, folderId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!Number.isInteger(folderId) || folderId < 1)
            return false;
        const accessible = yield getAccessibleFolderIds(prisma, currentUserId);
        return accessible.includes(folderId);
    });
}
