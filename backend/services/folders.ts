import type { PrismaClient } from '@prisma/client';

export async function collectFolderBranch(prisma: PrismaClient, folderId: number): Promise<number[]> {
  const ids = [folderId];
  const children = await prisma.folder.findMany({ where: { parentId: folderId }, select: { id: true } });
  for (const child of children) ids.push(...await collectFolderBranch(prisma, child.id));
  return ids;
}

/** Documents can only be stored in a subfolder, never at the root level. */
export async function isDocumentFolder(prisma: PrismaClient, folderId: unknown) {
  const folder = await prisma.folder.findUnique({ where: { id: Number(folderId) }, select: { parentId: true } });
  return Boolean(folder?.parentId);
}
