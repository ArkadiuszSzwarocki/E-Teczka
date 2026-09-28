import type { PrismaClient } from '@prisma/client';

export function retentionExpired(document: { createdAt: Date; retentionValue: number; retentionUnit: string }) {
  const expiry = new Date(document.createdAt);
  if (document.retentionUnit === 'years') expiry.setFullYear(expiry.getFullYear() + document.retentionValue);
  else if (document.retentionUnit === 'months') expiry.setMonth(expiry.getMonth() + document.retentionValue);
  else if (document.retentionUnit === 'days') expiry.setDate(expiry.getDate() + document.retentionValue);
  else if (document.retentionUnit === 'minutes') expiry.setMinutes(expiry.getMinutes() + document.retentionValue);
  else return false;
  return expiry.getTime() <= Date.now();
}

/** Applies the lifecycle rule independently of the desktop window. */
export async function applyRetentionPolicy(prisma: PrismaClient) {
  const candidates = await prisma.document.findMany({
    where: { retentionEnabled: true, isArchived: false, isDeleted: false },
    select: { id: true, createdAt: true, retentionValue: true, retentionUnit: true },
  });
  const expiredIds = candidates.filter(retentionExpired).map((document) => document.id);
  if (!expiredIds.length) return;
  await prisma.document.updateMany({ where: { id: { in: expiredIds } }, data: { isDeleted: true, deletedAt: new Date() } });
}
