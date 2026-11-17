import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { prepareTags, tagIds } from '../services/tagOwnership';
import { errorMessage, hasErrorCode } from '../utils/errors';
import { getPlan, PlanLimitError, checkTagCapacity } from '../services/planLedger';
import { markCentralInventoryDirty } from '../services/centralPlanLedger';
import { ocrOwnerKey } from '../services/ocrPremium';
import { PLAN_LIMITS } from '../services/planPolicy';
import { activeTagIds } from '../services/planRestrictions';

export function createTagRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/', async (_req, res) => {
    try { await prepareTags(prisma); const owner = Number(res.locals.userId || 1); const ids = await tagIds(prisma, owner); const active = await activeTagIds(prisma, owner, await getPlan(prisma, ocrOwnerKey(res))); const tags = await prisma.tag.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } }); res.json(tags.map(tag => ({ ...tag, inactive: active !== null && !active.has(tag.id) }))); }
    catch (error: unknown) { res.status(500).json({ error: 'Błąd pobierania tagów', details: errorMessage(error) }); }
  });
  router.post('/', async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim(); const color = String(req.body?.color || '#2563eb');
      if (!name) return res.status(400).json({ error: 'Podaj nazwę tagu.' });
      const ownerId = Number(res.locals.userId || 1); const plan = await getPlan(prisma, ocrOwnerKey(res)); await prepareTags(prisma);
      const tag = await prisma.$transaction(async tx => {
        const ids = await tagIds(tx, ownerId); const existing = await tx.tag.findUnique({ where: { name } });
        if (existing && ids.includes(existing.id)) throw new Error('Taki tag już istnieje.');
        await checkTagCapacity(tx,ownerId,plan,ids.length);
        const result = existing || await tx.tag.create({ data: { name, color } });
        await tx.$executeRaw`INSERT INTO PlanTagOwner(ownerId, tagId) VALUES (${ownerId}, ${result.id})`;
        return result;
      });
      res.status(201).json(tag);
    } catch (error: unknown) { if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message }); const duplicate = hasErrorCode(error, 'P2002') || errorMessage(error) === 'Taki tag już istnieje.'; res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Taki tag już istnieje.' : 'Błąd tworzenia tagu', details: errorMessage(error) }); }
  });
  router.delete('/:id', async (req, res) => {
    try { const id = Number(req.params.id); const ownerId = Number(res.locals.userId || 1); if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowy tag.' }); await prepareTags(prisma);
      const removed = await prisma.$transaction(async tx => {
        markCentralInventoryDirty();
        const deleted = await tx.$executeRaw`DELETE FROM PlanTagOwner WHERE ownerId = ${ownerId} AND tagId = ${id}`;
        if (!deleted) return false;
        const ownedDocs = await tx.document.findMany({ where: { folder: { ownerId } }, select: { id: true } });
        await tx.documentTag.deleteMany({ where: { tagId: id, documentId: { in: ownedDocs.map(doc => doc.id) } } });
        const owners = await tx.$queryRaw<Array<{ count: bigint | number }>>`SELECT COUNT(*) AS count FROM PlanTagOwner WHERE tagId = ${id}`;
        if (Number(owners[0].count) === 0) await tx.tag.delete({ where: { id } });
        return true;
      });
      if (!removed) return res.status(404).json({ error: 'Nie znaleziono tagu.' }); res.json({ success: true });
    } catch (error: unknown) { res.status(500).json({ error: 'Błąd usuwania tagu', details: errorMessage(error) }); }
  });
  return router;
}
