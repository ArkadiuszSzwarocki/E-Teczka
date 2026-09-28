import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { errorMessage, hasErrorCode } from '../utils/errors';
import { requirePremium } from '../middleware/premium';

/** Tag catalog routes. Document-tag assignments remain in the document routes. */
export function createTagRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/', async (_req, res) => {
    try { res.json(await prisma.tag.findMany({ orderBy: { name: 'asc' } })); }
    catch (error: unknown) { res.status(500).json({ error: 'Błąd pobierania tagów', details: errorMessage(error) }); }
  });
  router.post('/', requirePremium(prisma), async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim();
      const color = String(req.body?.color || '#2563eb');
      if (!name) return res.status(400).json({ error: 'Podaj nazwę tagu.' });
      res.status(201).json(await prisma.tag.create({ data: { name, color } }));
    } catch (error: unknown) {
      const duplicate = hasErrorCode(error, 'P2002');
      res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Taki tag już istnieje.' : 'Błąd tworzenia tagu', details: errorMessage(error) });
    }
  });
  router.delete('/:id', requirePremium(prisma), async (req, res) => {
    try { await prisma.tag.delete({ where: { id: Number(req.params.id) } }); res.json({ success: true }); }
    catch (error: unknown) { res.status(500).json({ error: 'Błąd usuwania tagu', details: errorMessage(error) }); }
  });
  return router;
}
