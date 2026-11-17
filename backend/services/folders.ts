import type { PrismaClient } from '@prisma/client';

export async function collectFolderBranch(prisma: PrismaClient, folderId: number, ownerId?: number): Promise<number[]> {
  const ids = [folderId];
  const children = await prisma.folder.findMany({ where: { parentId: folderId, ...(ownerId === undefined ? {} : { ownerId }) }, select: { id: true } });
  for (const child of children) ids.push(...await collectFolderBranch(prisma, child.id, ownerId));
  return ids;
}

/** Documents can be stored in both root and nested folders owned by the user. */
export async function isDocumentFolder(prisma: PrismaClient, folderId: unknown) {
  const id = Number(folderId);
  if (!Number.isInteger(id) || id < 1) return false;
  const folder = await prisma.folder.findUnique({ where: { id }, select: { id: true } });
  return Boolean(folder);
}
