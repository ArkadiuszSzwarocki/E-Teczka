import type { PrismaClient } from '@prisma/client';
import type { Plan } from './planPolicy';
import { PLAN_LIMITS } from './planPolicy';
import { listMailItems, type MailInboxItem } from './mailInboxStore';

export type MailInboxItemWithAccess = MailInboxItem & { locked?: boolean };

/** Annotates staged mail items with `locked: true` when they exceed the active plan's remaining document capacity. */
export async function annotateMailItemsAccess(
  prisma: PrismaClient,
  ownerId: number,
  plan: Plan,
  items: MailInboxItem[],
): Promise<MailInboxItemWithAccess[]> {
  const limit = PLAN_LIMITS[plan].documents;
  if (limit === null) {
    return items.map(item => ({ ...item, locked: false }));
  }
  const docCount = await prisma.document.count({ where: { folder: { ownerId } } });
  const remainingSlots = Math.max(0, limit - docCount);
  return items.map((item, idx) => ({
    ...item,
    locked: idx >= remainingSlots,
  }));
}

/** Checks whether a specific staged mail item is locked by the active plan's document capacity limit. */
export async function isMailItemLocked(
  prisma: PrismaClient,
  ownerId: number,
  plan: Plan,
  itemId: string,
): Promise<boolean> {
  const limit = PLAN_LIMITS[plan].documents;
  if (limit === null) return false;
  const items = listMailItems(ownerId);
  const idx = items.findIndex(i => i.id === itemId);
  if (idx < 0) return false;
  const docCount = await prisma.document.count({ where: { folder: { ownerId } } });
  const remainingSlots = Math.max(0, limit - docCount);
  return idx >= remainingSlots;
}
