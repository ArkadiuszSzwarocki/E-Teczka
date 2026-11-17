import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { securityDir } from '../config/paths';
import { createFolderVaultStore } from './folderVault';

let schemaReady: Promise<void> | null = null;
const vaultStore = createFolderVaultStore(path.join(securityDir, 'folder-vault.enc'));

/** Ensures family group, member, and invite tables exist in SQLite. */
export async function ensureFamilySchema(prisma: PrismaClient): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await prisma.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS FamilyGroup (id INTEGER PRIMARY KEY AUTOINCREMENT, hostUserId INTEGER NOT NULL UNIQUE, createdAt TEXT NOT NULL)',
      );
      await prisma.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS FamilyMember (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, userId INTEGER NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT \'member\', status TEXT NOT NULL DEFAULT \'active\', joinedAt TEXT NOT NULL)',
      );
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS FamilyMember_group_status_idx ON FamilyMember(groupId, status)',
      );
      await prisma.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS FamilyInvite (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId INTEGER NOT NULL, email TEXT NOT NULL, code TEXT NOT NULL UNIQUE, createdByUserId INTEGER NOT NULL, expiresAt TEXT NOT NULL, acceptedAt TEXT, createdAt TEXT NOT NULL)',
      );
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS FamilyInvite_email_idx ON FamilyInvite(email)',
      );
    })();
  }
  await schemaReady;
}

/** Returns all active user IDs sharing non-vault folders with the given user. */
export async function getFamilyVisibleOwnerIds(prisma: PrismaClient, userId: number): Promise<number[]> {
  await ensureFamilySchema(prisma);
  const memberships = await prisma.$queryRaw<Array<{ groupId: number }>>`
    SELECT groupId FROM FamilyMember WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `;
  const groupId = memberships[0]?.groupId;
  if (!groupId) return [userId];

  const rows = await prisma.$queryRaw<Array<{ userId: number }>>`
    SELECT userId FROM FamilyMember WHERE groupId = ${groupId} AND status = 'active'
  `;
  const ids = Array.from(new Set(rows.map(row => Number(row.userId)).filter(id => Number.isInteger(id) && id > 0)));
  return ids.includes(userId) ? ids : [userId, ...ids];
}

function isVaultFolder(ownerId: number, folderId: number, name: string): boolean {
  if (name.trim().toLowerCase() === 'sejf') return true;
  try {
    return vaultStore.status(`${ownerId}:${folderId}`).configured;
  } catch {
    return false;
  }
}

/**
 * Returns all folder IDs visible to `currentUserId`, including shared family folders
 * while strictly hiding every other user's personal Vault ("Sejf" or vault-locked branch).
 */
export async function getAccessibleFolderIds(prisma: PrismaClient, currentUserId: number): Promise<number[]> {
  const ownerIds = await getFamilyVisibleOwnerIds(prisma, currentUserId);
  const folders = await prisma.folder.findMany({
    where: { ownerId: { in: ownerIds } },
    select: { id: true, name: true, parentId: true, ownerId: true },
  });

  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const hiddenCache = new Map<number, boolean>();

  const isHiddenFromUser = (folderId: number, visited = new Set<number>()): boolean => {
    const cached = hiddenCache.get(folderId);
    if (cached !== undefined) return cached;
    if (visited.has(folderId)) return false;
    visited.add(folderId);

    const folder = byId.get(folderId);
    if (!folder) return true;
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
}

/** Checks whether `currentUserId` can collaborate on `folderId` (respecting private Vault isolation). */
export async function canAccessFolder(prisma: PrismaClient, currentUserId: number, folderId: number): Promise<boolean> {
  if (!Number.isInteger(folderId) || folderId < 1) return false;
  const accessible = await getAccessibleFolderIds(prisma, currentUserId);
  return accessible.includes(folderId);
}
