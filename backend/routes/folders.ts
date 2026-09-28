import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { collectFolderBranch } from '../services/folders';
import { errorMessage } from '../utils/errors';

export function createFolderRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
  router.get('/', async (_req, res) => {
    try { res.json(await prisma.folder.findMany({ where: { ownerId: ownerId(res) }, orderBy: { order: 'asc' }, include: { _count: { select: { documents: { where: { isArchived: false, isDeleted: false } } } } } })); }
    catch (error: unknown) { const details = errorMessage(error); console.error('[GET /api/folders] Błąd bazy:', details); res.status(500).json({ error: 'Błąd pobierania kartotek', details }); }
  });
  router.post('/', async (req, res) => {
    try { const { name, parentId } = req.body; const currentOwner = ownerId(res); const count = await prisma.folder.count({ where: { parentId: parentId ? Number(parentId) : null, ownerId: currentOwner } }); res.json(await prisma.folder.create({ data: { name, parentId: parentId ? Number(parentId) : null, order: count, ownerId: currentOwner } })); }
    catch (error: unknown) { const details = errorMessage(error); console.error('[POST /api/folders] Błąd tworzenia:', details); res.status(500).json({ error: 'Błąd tworzenia kartoteki', details }); }
  });
  router.use('/:id', async (req, res, next) => {
    const folder = await prisma.folder.findFirst({ where: { id: Number(req.params.id), ownerId: ownerId(res) } });
    if (!folder) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    next();
  });
  router.patch('/:id', async (req, res) => {
    try { const { name } = req.body; if (name) return res.json(await prisma.folder.update({ where: { id: Number(req.params.id) }, data: { name } })); res.json({ success: true }); }
    catch (error: unknown) { const details = errorMessage(error); console.error(`[PATCH /api/folders/${req.params.id}] Błąd edycji:`, details); res.status(500).json({ error: 'Błąd edycji kartoteki', details }); }
  });
  router.patch('/:id/move', async (req, res) => {
    try {
      const target = await prisma.folder.findUnique({ where: { id: Number(req.params.id) } });
      if (!target) return res.status(404).json({ error: 'Brak folderu' });
      const siblings = await prisma.folder.findMany({ where: { parentId: target.parentId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
      siblings.forEach((folder, index) => { folder.order = index; });
      const index = siblings.findIndex(folder => folder.id === target.id);
      if (req.body.direction === 'up' && index > 0) [siblings[index].order, siblings[index - 1].order] = [siblings[index - 1].order, siblings[index].order];
      if (req.body.direction === 'down' && index < siblings.length - 1) [siblings[index].order, siblings[index + 1].order] = [siblings[index + 1].order, siblings[index].order];
      await prisma.$transaction(siblings.map(folder => prisma.folder.update({ where: { id: folder.id }, data: { order: folder.order } })));
      res.json({ success: true });
    } catch (error: unknown) { const details = errorMessage(error); console.error(`[PATCH /api/folders/${req.params.id}/move] Błąd sortowania:`, details); res.status(500).json({ error: 'Błąd sortowania', details }); }
  });
  router.get('/:id/delete-preview', async (req, res) => {
    try { const ids = await collectFolderBranch(prisma, Number(req.params.id)); res.json({ folderIds: ids, documentCount: await prisma.document.count({ where: { folderId: { in: ids } } }) }); }
    catch (error: unknown) { res.status(500).json({ error: 'Nie udało się sprawdzić zawartości kartoteki.', details: errorMessage(error) }); }
  });
  router.post('/:id/delete-safely', async (req, res) => {
    try {
      const ids = await collectFolderBranch(prisma, Number(req.params.id));
      const documentCount = await prisma.document.count({ where: { folderId: { in: ids } } });
      const transferFolderId = req.body?.transferFolderId ? Number(req.body.transferFolderId) : null;
      if (documentCount && (!transferFolderId || ids.includes(transferFolderId))) return res.status(400).json({ error: 'Wybierz inną kartotekę docelową dla dokumentów.' });
      if (transferFolderId) { const target = await prisma.folder.findUnique({ where: { id: transferFolderId }, select: { parentId: true } }); if (!target) return res.status(400).json({ error: 'Wybrana kartoteka docelowa nie istnieje.' }); if (!target.parentId) return res.status(400).json({ error: 'Dokumenty można przenieść wyłącznie do podkartoteki.' }); }
      await prisma.$transaction(async tx => { if (documentCount && transferFolderId) await tx.document.updateMany({ where: { folderId: { in: ids } }, data: { folderId: transferFolderId } }); for (const folderId of [...ids].reverse()) await tx.folder.delete({ where: { id: folderId } }); });
      res.json({ success: true, movedDocuments: documentCount });
    } catch (error: unknown) { res.status(500).json({ error: 'Błąd usuwania kartoteki', details: errorMessage(error) }); }
  });
  return router;
}
