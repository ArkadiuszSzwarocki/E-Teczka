import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { ocrOwnerKey, hasOcrPremium } from '../services/ocrPremium';
import { protectOcrText, safeReadOcrText } from '../services/ocrText';
import { indexDocumentOcrText, searchEncryptedOcrDocuments } from '../services/ocrSearchIndex';
import type { createOcrQueue } from '../services/ocrQueue';
import { activeDocumentIds } from '../services/planRestrictions';
import { getPlan } from '../services/planLedger';
import { getAccessibleFolderIds } from '../services/familyAccess';
import { getLearnedFolderBoosts, recordFolderChoice } from '../services/folderLearningStore';
import { suggestFolderForDocument } from '../services/statelessAiClassifier';

export function createOcrRouter(prisma: PrismaClient, queue: ReturnType<typeof createOcrQueue>) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    try { if (!await hasOcrPremium(prisma, res, req.method === 'POST')) return res.status(402).json({ error: 'Rozpocznij okres próbny OCR albo wybierz Premium, jeśli okres próbny się zakończył.', code: 'OCR_UNAVAILABLE' }); next(); }
    catch (error) { next(error); }
  });
  router.get('/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase('pl') : '';
    if (!query || query.length > 200) return res.status(400).json({ error: 'Podaj tekst wyszukiwania (maksymalnie 200 znaków).' });
    try {
      const ids = await searchEncryptedOcrDocuments(prisma, Number(res.locals.userId || 1), query);
      res.setHeader('Cache-Control', 'no-store'); res.json({ ids });
    } catch { res.status(500).json({ error: 'Nie udało się przeszukać rozpoznanego tekstu.' }); }
  });
  router.post('/suggest-folder', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim() || text.length > 200_000) {
      return res.status(400).json({ error: 'Podaj tekst dokumentu (maksymalnie 200 000 znaków).' });
    }
    try {
      const ownerId = Number(res.locals.userId || 1);
      const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
      const folders = await prisma.folder.findMany({
        where: { id: { in: accessibleIds } },
        select: { id: true, name: true, parentId: true },
      });
      const learnedBoosts = getLearnedFolderBoosts(ownerId, text);
      const result = await suggestFolderForDocument(text, folders, {
        allowServerAi: req.body?.allowServerAi === true,
        learnedBoosts,
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(result);
    } catch {
      return res.status(500).json({ error: 'Nie udało się dopasować kartoteki do dokumentu.' });
    }
  });
  router.post('/learn-folder', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const folderId = Number(req.body?.folderId);
    if (!text.trim() || text.length > 200_000 || !Number.isSafeInteger(folderId) || folderId < 1) {
      return res.status(400).json({ error: 'Podaj tekst dokumentu oraz prawidłowy identyfikator kartoteki.' });
    }
    try {
      const ownerId = Number(res.locals.userId || 1);
      const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
      if (!accessibleIds.includes(folderId)) {
        return res.status(404).json({ error: 'Nie znaleziono wskazanej kartoteki.' });
      }
      const learnedCount = recordFolderChoice(ownerId, text, folderId);
      return res.json({ success: true, learnedCount });
    } catch {
      return res.status(500).json({ error: 'Nie udało się zapisać reguły dopasowania kartoteki.' });
    }
  });
  router.post('/batch', async (req, res) => {
    const ids = req.body?.documentIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id: unknown) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) return res.status(400).json({ error: 'Wybierz od 1 do 100 dokumentów.' });
    const uniqueIds: number[] = [...new Set<number>(ids)];
    try {
      const documents = await prisma.document.findMany({ where: { id: { in: uniqueIds }, folder: { ownerId: Number(res.locals.userId || 1) }, isDeleted: false }, select: { id: true } });
      if (documents.length !== uniqueIds.length) return res.status(404).json({ error: 'Nie znaleziono wszystkich dokumentów.' });
      const active = await activeDocumentIds(prisma, Number(res.locals.userId || 1), await getPlan(prisma, ocrOwnerKey(res)));
      if (active && uniqueIds.some(id => !active.has(id))) return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Niektóre dokumenty są tylko do odczytu z powodu limitu planu.' });
      for (const document of documents) queue.enqueue(document.id, ocrOwnerKey(res));
      return res.status(202).json({ queued: documents.length });
    } catch { return res.status(500).json({ error: 'Nie udało się dodać dokumentów do kolejki OCR.' }); }
  });
  router.use('/:id', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Nieprawidłowy dokument.' });
    const found = await prisma.document.findFirst({ where: { id, folder: { ownerId: Number(res.locals.userId || 1) }, isDeleted: false }, select: { id: true } });
    if (!found) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
    const active = await activeDocumentIds(prisma, Number(res.locals.userId || 1), await getPlan(prisma, ocrOwnerKey(res))); if (active && !active.has(id)) return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument jest tylko do odczytu z powodu limitu planu.' });
    next();
  });
  router.post('/:id', (req, res) => {
    try { queue.enqueue(Number(req.params.id), ocrOwnerKey(res)); res.status(202).json({ status: 'queued' }); }
    catch { res.status(500).json({ error: 'Nie udało się dodać dokumentu do kolejki OCR.' }); }
  });
  router.get('/:id', async (req, res) => {
    try {
      const document = await prisma.document.findUnique({ where: { id: Number(req.params.id) }, select: { ocrText: true } });
      const status = queue.status(Number(req.params.id), ocrOwnerKey(res));
      const fullText = document?.ocrText ? safeReadOcrText(document.ocrText) : '';
      const rawOffset = Number(req.query.offset);
      const rawLimit = Number(req.query.limit);
      const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
      const hasLimit = Number.isInteger(rawLimit) && rawLimit > 0;
      const text = hasLimit ? fullText.slice(offset, offset + Math.min(rawLimit, 100_000)) : fullText;
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ...status,
        text,
        totalLength: fullText.length,
        offset,
        hasMore: offset + text.length < fullText.length,
      });
    } catch { res.status(500).json({ error: 'Nie udało się odczytać wyniku OCR.' }); }
  });
  router.put('/:id', async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || text.length > 2_000_000) return res.status(400).json({ error: 'Tekst OCR może mieć maksymalnie 2 000 000 znaków.' });
    try {
      const status = queue.status(Number(req.params.id), ocrOwnerKey(res));
      if (status.state === 'queued' || status.state === 'processing') return res.status(409).json({ error: 'Poczekaj na zakończenie rozpoznawania przed zapisem zmian.' });
      const result = await prisma.document.updateMany({ where: { id: Number(req.params.id), folder: { ownerId: Number(res.locals.userId || 1) }, isDeleted: false }, data: { ocrText: protectOcrText(text) } });
      if (!result.count) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
      res.json({ success: true });
    } catch { res.status(500).json({ error: 'Nie udało się zapisać tekstu OCR.' }); }
  });
  return router;
}
