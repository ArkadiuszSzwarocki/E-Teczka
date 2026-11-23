import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { collectFolderBranch } from '../services/folders';
import { buildFolderHistoryPdf } from '../services/folderHistoryReportService';
import { applyFolderTemplate, isFolderTemplateId } from '../services/folderTemplates';
import { canAccessFolder, getAccessibleFolderIds } from '../services/familyAccess';
import { errorMessage } from '../utils/errors';

export function createFolderRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
  router.get('/', async (_req, res) => {
    try {
      const accessibleIds = await getAccessibleFolderIds(prisma, ownerId(res));
      res.json(await prisma.folder.findMany({ where: { id: { in: accessibleIds } }, orderBy: { order: 'asc' }, include: { _count: { select: { documents: { where: { isArchived: false, isDeleted: false } } } } } }));
    }
    catch (error: unknown) { const details = errorMessage(error); console.error('[GET /api/folders] Błąd bazy:', details); res.status(500).json({ error: 'Błąd pobierania kartotek', details }); }
  });
  router.post('/', async (req, res) => {
    try {
      const { name, parentId } = req.body; const currentOwner = ownerId(res);
      const parsedParent = parentId ? Number(parentId) : null;
      if (parsedParent !== null && !await canAccessFolder(prisma, currentOwner, parsedParent)) {
        return res.status(403).json({ error: 'Brak dostępu do kartoteki nadrzędnej.' });
      }
      const count = await prisma.folder.count({ where: { parentId: parsedParent, ownerId: currentOwner } });
      res.json(await prisma.folder.create({ data: { name, parentId: parsedParent, order: count, ownerId: currentOwner } }));
    }
    catch (error: unknown) { const details = errorMessage(error); console.error('[POST /api/folders] Błąd tworzenia:', details); res.status(500).json({ error: 'Błąd tworzenia kartoteki', details }); }
  });
  router.post('/reorder', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
      if (!ids.length) return res.status(400).json({ error: 'Brak listy kartotek.' });
      const accessible = new Set(await getAccessibleFolderIds(prisma, ownerId(res)));
      const allowedIds = ids.filter((id: number) => accessible.has(id));
      await prisma.$transaction(allowedIds.map((id: number, idx: number) => prisma.folder.updateMany({ where: { id }, data: { order: idx } })));
      res.json({ success: true });
    } catch (error: unknown) { res.status(500).json({ error: 'Błąd zapisu kolejności kartotek.', details: errorMessage(error) }); }
  });
  router.post('/apply-template', async (req, res) => {
    try {
      const templateId = req.body?.templateId;
      if (!isFolderTemplateId(templateId)) {
        return res.status(400).json({ error: 'Wybierz poprawny szablon kartotek (home lub business).' });
      }
      const result = await applyFolderTemplate(prisma, ownerId(res), templateId);
      res.status(201).json({ success: true, ...result });
    } catch (error: unknown) {
      res.status(500).json({ error: 'Nie udało się utworzyć szablonu kartotek.', details: errorMessage(error) });
    }
  });
  router.use('/:id', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!await canAccessFolder(prisma, ownerId(res), id)) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    next();
  });
  router.patch('/:id', async (req, res) => {
    try {
      const { name, parentId } = req.body || {};
      const data: { name?: string; parentId?: number | null } = {};
      if (typeof name === 'string' && name.trim()) data.name = name.trim();
      if (parentId !== undefined) {
        if (parentId === null) data.parentId = null;
        else {
          const targetParent = Number(parentId);
          const branch = await collectFolderBranch(prisma, Number(req.params.id), ownerId(res));
          if (!Number.isInteger(targetParent) || branch.includes(targetParent)) return res.status(400).json({ error: 'Nie można przenieść kartoteki do samej siebie ani podkartoteki.' });
          const owned = await prisma.folder.findFirst({ where: { id: targetParent, ownerId: ownerId(res) }, select: { id: true } });
          if (!owned) return res.status(404).json({ error: 'Nie znaleziono kartoteki docelowej.' });
          data.parentId = targetParent;
        }
      }
      if (Object.keys(data).length) return res.json(await prisma.folder.update({ where: { id: Number(req.params.id) }, data }));
      res.json({ success: true });
    }
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
  router.get('/:id/history-pdf', async (req, res) => {
    try {
      const { bytes, folderName } = await buildFolderHistoryPdf(prisma, ownerId(res), Number(req.params.id));
      const safeName = folderName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'kartoteka';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="MojaTeczka-Historia-${safeName}.pdf"`);
      res.send(Buffer.from(bytes));
    } catch (error: unknown) {
      res.status(500).json({ error: 'Nie udało się wygenerować raportu historii PDF.', details: errorMessage(error) });
    }
  });
  router.get('/:id/delete-preview', async (req, res) => {
    try {
      const ids = await collectFolderBranch(prisma, Number(req.params.id), ownerId(res));
      const [documentCount, archivedCount, trashedCount] = await Promise.all([
        prisma.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: false } }),
        prisma.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: true } }),
        prisma.document.count({ where: { folderId: { in: ids }, isDeleted: true } }),
      ]);
      res.json({ folderIds: ids, documentCount, archivedCount, trashedCount });
    } catch (error: unknown) { res.status(500).json({ error: 'Nie udało się sprawdzić zawartości kartoteki.', details: errorMessage(error) }); }
  });
  router.post('/:id/delete-safely', async (req, res) => {
    try {
      const currentOwner = ownerId(res); const sourceId = Number(req.params.id);
      const transferFolderId = req.body?.transferFolderId ? Number(req.body.transferFolderId) : null;
      const mode = req.body?.mode === 'trash' ? 'trash' : 'transfer';
      const result = await prisma.$transaction(async tx => {
        const source = await tx.folder.findFirst({ where: { id: sourceId, ownerId: currentOwner }, select: { id: true } });
        if (!source) throw new Error('Kartoteka już nie istnieje.');
        const ids = await collectFolderBranch(tx as PrismaClient, sourceId, currentOwner);
        const foreignChildren = await tx.folder.count({ where: { parentId: { in: ids }, ownerId: { not: currentOwner } } });
        if (foreignChildren) throw new Error('Kartoteka zawiera podkartoteki innego użytkownika.');
        const [documentCount, archivedCount, trashedCount] = await Promise.all([
          tx.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: false } }),
          tx.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: true } }),
          tx.document.count({ where: { folderId: { in: ids }, isDeleted: true } }),
        ]);
        const totalDocs = documentCount + archivedCount + trashedCount;
        if (mode === 'trash') {
          if (totalDocs > 0) {
            const fallback = await tx.folder.findFirst({ where: { ownerId: currentOwner, id: { notIn: ids } }, orderBy: [{ parentId: 'desc' }, { id: 'asc' }], select: { id: true } });
            if (!fallback) throw new Error('Aby przenieść dokumenty do kosza i usunąć tę kartotekę, pozostaw w systemie przynajmniej jedną inną kartotekę.');
            await tx.document.updateMany({ where: { folderId: { in: ids } }, data: { isDeleted: true, isArchived: false, deletedAt: new Date(), folderId: fallback.id } });
          }
          for (const folderId of [...ids].reverse()) await tx.folder.delete({ where: { id: folderId } });
          return { success: true, movedDocuments: 0, trashedDocuments: documentCount + archivedCount, preservedArchived: 0, preservedTrash: trashedCount, targetFolderId: null };
        }
        if (documentCount && (!transferFolderId || ids.includes(transferFolderId))) throw new Error('Wybierz inną podkartotekę docelową dla aktywnych dokumentów.');
        let targetId = transferFolderId;
        if (targetId) {
          const target = await tx.folder.findFirst({ where: { id: targetId, ownerId: currentOwner }, select: { id: true, parentId: true } });
          if (!target || ids.includes(targetId) || !target.parentId) throw new Error('Wybierz istniejącą podkartotekę docelową poza usuwaną kartoteką.');
        } else if (archivedCount || trashedCount) {
          throw new Error('Wybierz podkartotekę, aby zachować dokumenty z archiwum i kosza.');
        }
        if (targetId && totalDocs) await tx.document.updateMany({ where: { folderId: { in: ids } }, data: { folderId: targetId } });
        for (const folderId of [...ids].reverse()) await tx.folder.delete({ where: { id: folderId } });
        return { success: true, movedDocuments: documentCount, preservedArchived: archivedCount, preservedTrash: trashedCount, targetFolderId: targetId };
      });
      res.json(result);
    } catch (error: unknown) { res.status(409).json({ error: errorMessage(error) || 'Błąd usuwania kartoteki.' }); }
  });
  return router;
}
