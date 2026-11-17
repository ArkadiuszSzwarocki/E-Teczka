import type { Prisma, PrismaClient } from '@prisma/client';
import { PLAN_LIMITS, type Plan } from './planPolicy';
import {centralOwner} from './centralPlanLedger';
import {centralPlanRequest} from './centralEntitlements';

type Db = PrismaClient | Prisma.TransactionClient;
export async function activeDocumentIds(db: Db, ownerId: number, plan: Plan): Promise<Set<number> | null> {
  const central=centralOwner(`user:${ownerId}`);const limit = central?(await centralPlanRequest(central,'/ledger/status')).allowance.documents:PLAN_LIMITS[plan].documents;
  if (limit === null) return null;
  const documents = await db.document.findMany({ where: { folder: { ownerId } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit, select: { id: true } });
  return new Set(documents.map(document => document.id));
}
export async function activeTagIds(db: Db, ownerId: number, plan: Plan): Promise<Set<number> | null> {
  const central=centralOwner(`user:${ownerId}`);const limit = central?(await centralPlanRequest(central,'/ledger/status')).allowance.tags:PLAN_LIMITS[plan].tags;
  if (limit === null) return null;
  const tags = await db.$queryRaw<Array<{ id: number | bigint }>>`SELECT t.id FROM Tag t JOIN PlanTagOwner o ON o.tagId=t.id WHERE o.ownerId=${ownerId} ORDER BY t.createdAt ASC,t.id ASC LIMIT ${limit}`;
  return new Set(tags.map(tag => Number(tag.id)));
}
