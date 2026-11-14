import type { Prisma, PrismaClient } from '@prisma/client';

export async function prepareTags(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanTagOwner (ownerId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY (ownerId, tagId), FOREIGN KEY(tagId) REFERENCES Tag(id) ON DELETE CASCADE)');
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanMeta (key TEXT PRIMARY KEY)');
  await prisma.$transaction(async tx => {
    const marked = await tx.$queryRaw<Array<{ key: string }>>`SELECT key FROM PlanMeta WHERE key = ${'tag-ownership-v1'}`;
    if (marked.length) return;
    await tx.$executeRawUnsafe('INSERT OR IGNORE INTO PlanTagOwner(ownerId, tagId) SELECT DISTINCT f.ownerId, dt.tagId FROM DocumentTag dt JOIN Document d ON d.id=dt.documentId JOIN Folder f ON f.id=d.folderId');
    await tx.$executeRawUnsafe('INSERT OR IGNORE INTO PlanTagOwner(ownerId, tagId) SELECT 1, t.id FROM Tag t WHERE NOT EXISTS (SELECT 1 FROM PlanTagOwner o WHERE o.tagId=t.id)');
    await tx.$executeRaw`INSERT OR IGNORE INTO PlanMeta(key) VALUES (${'tag-ownership-v1'})`;
  });
}
export async function tagIds(tx: Prisma.TransactionClient | PrismaClient, ownerId: number): Promise<number[]> {
  const rows = await tx.$queryRaw<Array<{ tagId: bigint | number }>>`SELECT tagId FROM PlanTagOwner WHERE ownerId = ${ownerId}`;
  return rows.map(row => Number(row.tagId));
}
