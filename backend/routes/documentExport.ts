import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { hasPremium } from '../middleware/premium';
import { getAccessibleFolderIds } from '../services/familyAccess';
import { activeDocumentIds } from '../services/planRestrictions';
import { getPlan } from '../services/planLedger';
import { ocrOwnerKey } from '../services/ocrPremium';
import { exportDocumentsAsPdf } from '../services/documentExportPdf';
import { applyWatermarkToPdf } from '../services/documentWatermark';
import { exportPdfWithRodoRegions, type RodoExportRegion } from '../services/rodoPdfExport';
import { errorMessage } from '../utils/errors';

/** Handles PDF export (with optional owner watermark) as a dedicated sub-router. */
export function createDocumentExportRouter(prisma: PrismaClient, ownerId: (res: express.Response) => number) {
  const router = express.Router();

  router.post('/export-pdf', async (req, res) => {
    try {
      if (!await hasPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Eksport grupowy wymaga planu Premium.' });
      const ids = Array.isArray(req.body?.documentIds) ? req.body.documentIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0) : [];
      if (!ids.length || ids.length > 100) return res.status(400).json({ error: 'Wybierz od 1 do 100 dokumentów.' });
      const accessible = await getAccessibleFolderIds(prisma, ownerId(res));
      const records = await prisma.document.findMany({ where: { id: { in: ids }, folderId: { in: accessible } } });
      if (records.length !== ids.length) return res.status(403).json({ error: 'Nie masz dostępu do wszystkich wybranych dokumentów.' });
      const active = await activeDocumentIds(prisma, ownerId(res), await getPlan(prisma, ocrOwnerKey(res)));
      if (active && ids.some((docId: number) => !active.has(docId))) return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Co najmniej jeden wybrany dokument jest tylko do odczytu w obecnym planie.' });
      const watermark = req.body?.watermark === true;
      let bytes = await exportDocumentsAsPdf(records);
      if (watermark) {
        const owner = await prisma.user.findUnique({ where: { id: ownerId(res) }, select: { email: true } });
        const ownerEmail = owner?.email || String(res.locals.userEmail || 'Właściciel MojejTeczki');
        bytes = await applyWatermarkToPdf(bytes, ownerEmail);
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="mojateczka-eksport-${Date.now()}.pdf"`);
      res.send(bytes);
    } catch (error: unknown) {
      console.error('[POST /api/documents/export-pdf]', error);
      res.status(500).json({ error: 'Nie udało się utworzyć połączonego PDF-a.', details: errorMessage(error) });
    }
  });

  router.post('/:id/export-rodo', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Nieprawidłowy identyfikator dokumentu.' });
      const accessible = await getAccessibleFolderIds(prisma, ownerId(res));
      const doc = await prisma.document.findFirst({ where: { id, folderId: { in: accessible } } });
      if (!doc) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
      const rawRegions = Array.isArray(req.body?.regions) ? req.body.regions : [];
      const regions: RodoExportRegion[] = rawRegions
        .filter((r: unknown): r is RodoExportRegion => Boolean(r && typeof r === 'object'))
        .map((r: RodoExportRegion) => ({
          x: Math.max(0, Math.min(100, Number(r.x) || 0)),
          y: Math.max(0, Math.min(100, Number(r.y) || 0)),
          w: Math.max(0.5, Math.min(100, Number(r.w) || 0)),
          h: Math.max(0.5, Math.min(100, Number(r.h) || 0)),
          page: Math.max(1, Math.round(Number(r.page) || 1)),
        }));
      const bytes = await exportPdfWithRodoRegions(doc.filePath, regions);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="rodo-${id}.pdf"`);
      res.send(Buffer.from(bytes));
    } catch (error: unknown) {
      console.error('[POST /api/documents/:id/export-rodo]', error);
      res.status(500).json({ error: 'Nie udało się wyeksportować dokumentu z RODO.', details: errorMessage(error) });
    }
  });

  return router;
}
