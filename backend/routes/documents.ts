import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { isDocumentFolder } from '../services/folders';
import { errorMessage } from '../utils/errors';
import { buildIdCardCopyPdf } from '../services/idCardCopyService';
import { hasPremium } from '../middleware/premium';
import { enqueuePremiumOcr } from '../services/ocrEnqueue';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan, PlanLimitError } from '../services/planLedger';
import type { createOcrQueue } from '../services/ocrQueue';
import { UnsupportedMergeFormat } from '../services/mergeDocuments';
import { parseBase64DataUrl } from '../services/base64DataUrl';
import { prepareTags, tagIds as getOwnedTagIds } from '../services/tagOwnership';
import { canAccessFolder, getAccessibleFolderIds } from '../services/familyAccess';
import { initResumableSession, writeResumableChunk, completeResumableSession } from '../services/resumableUpload';
import { activeDocumentIds, activeTagIds } from '../services/planRestrictions';
import { assertUniqueDocument, DuplicateDocumentError, hashFile } from '../services/duplicateDocuments';
import { saveBatchBase64Documents, saveMergedBase64Document } from '../services/documentBase64Upload';
import { BusinessPlanRequiredError, saveBatchBinaryDocuments } from '../services/documentBinaryUpload';
import { createDocumentExportRouter } from './documentExport';
import { backfillDocumentExpiriesFromOcr } from '../services/expiryBackfillService';

const retentionUnits = new Set(['years', 'months', 'days', 'minutes']);

function documentUpdate(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  const allowed = new Set(['title', 'folderId', 'retentionEnabled', 'retentionValue', 'retentionUnit', 'isArchived', 'isDeleted', 'deletedAt', 'createdAt', 'tagIds', 'amountCents', 'currency', 'dueDate', 'paymentStatus']);
  if (Object.keys(source).some((key) => !allowed.has(key))) return null;
  if (source.title !== undefined && (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 255)) return null;
  if (source.folderId !== undefined && (!Number.isInteger(Number(source.folderId)) || Number(source.folderId) < 1)) return null;
  if (source.retentionEnabled !== undefined && typeof source.retentionEnabled !== 'boolean') return null;
  if (source.retentionValue !== undefined && (!Number.isInteger(Number(source.retentionValue)) || Number(source.retentionValue) < 1)) return null;
  if (source.retentionUnit !== undefined && (typeof source.retentionUnit !== 'string' || !retentionUnits.has(source.retentionUnit))) return null;
  if (source.isArchived !== undefined && typeof source.isArchived !== 'boolean') return null;
  if (source.isDeleted !== undefined && typeof source.isDeleted !== 'boolean') return null;
  if (source.deletedAt !== undefined && source.deletedAt !== null && (typeof source.deletedAt !== 'string' || Number.isNaN(new Date(source.deletedAt).getTime()))) return null;
  if (source.createdAt !== undefined && (typeof source.createdAt !== 'string' || Number.isNaN(new Date(source.createdAt).getTime()))) return null;
  if (source.tagIds !== undefined && (!Array.isArray(source.tagIds) || source.tagIds.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1))) return null;
  if (source.amountCents !== undefined && source.amountCents !== null && (!Number.isInteger(Number(source.amountCents)) || Number(source.amountCents) < 0 || Number(source.amountCents) > 1_000_000_000)) return null;
  if (source.currency !== undefined && (typeof source.currency !== 'string' || !/^[A-Z]{3}$/.test(source.currency))) return null;
  if (source.dueDate !== undefined && source.dueDate !== null && (typeof source.dueDate !== 'string' || Number.isNaN(new Date(source.dueDate).getTime()))) return null;
  if (source.paymentStatus !== undefined && source.paymentStatus !== null && !['paid', 'unpaid'].includes(String(source.paymentStatus))) return null;
  const normalized: Record<string, unknown> = { ...source };
  if (typeof source.deletedAt === 'string') normalized.deletedAt = new Date(source.deletedAt);
  if (typeof source.createdAt === 'string') normalized.createdAt = new Date(source.createdAt);
  if (typeof source.dueDate === 'string') normalized.dueDate = new Date(source.dueDate);
  return normalized;
}

function safeErrorPayload(message: string, details: string) {
  return process.env.NODE_ENV === 'production' ? { error: message } : { error: message, details };
}

/** Document listing, metadata changes and desktop Base64 uploads. */
export function createDocumentRouter(prisma: PrismaClient, ocrQueue?: ReturnType<typeof createOcrQueue>) {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
  // Delete only records currently in trash within folders accessible to this owner; shared file paths remain intact.
  const removeTrashed = async (owner: number, id?: number) => {
    const accessibleIds = await getAccessibleFolderIds(prisma, owner);
    const where = { isDeleted: true, folderId: { in: accessibleIds }, ...(id === undefined ? {} : { id }) };
    const records = await prisma.document.findMany({ where, select: { id: true, filePath: true } });
    const ids = records.map(record => record.id);
    if (ids.length) await prisma.$transaction(async tx => {
      await tx.documentLineItem.deleteMany({ where: { documentId: { in: ids } } });
      await tx.documentTag.deleteMany({ where: { documentId: { in: ids } } });
      await tx.document.deleteMany({ where: { ...where, id: { in: ids } } });
    });
    let failedFiles = 0;
    for (const file of new Set(records.map(record => record.filePath))) {
      if (!file || path.basename(file) !== file) { failedFiles++; continue; }
      if (await prisma.document.count({ where: { filePath: file } })) continue;
      try { await fs.promises.unlink(path.join(uploadsDir, file)); }
      catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { failedFiles++; console.error('[trash] Nie udało się usunąć pliku:', errorMessage(error)); } }
    }
    return { deleted: records.length, failedFiles };
  };
  router.post('/id-card-copy', async (req, res) => {
    try {
      const frontDataUrl = typeof req.body?.frontDataUrl === 'string' ? req.body.frontDataUrl : '';
      const backDataUrl = typeof req.body?.backDataUrl === 'string' ? req.body.backDataUrl : null;
      const recipient = typeof req.body?.recipient === 'string' ? req.body.recipient : '';
      if (!frontDataUrl || !recipient.trim()) {
        return res.status(400).json({ error: 'Wymagane jest zdjęcie przodu dokumentu oraz nazwa odbiorcy.' });
      }
      const bytes = await buildIdCardCopyPdf({ frontDataUrl, backDataUrl, recipient });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="MojaTeczka-kopia-dokumentu.pdf"');
      res.send(Buffer.from(bytes));
    } catch (error) {
      res.status(400).json({ error: errorMessage(error, 'Nie udało się wygenerować bezpiecznej kopii A4.') });
    }
  });
  router.post('/empty-trash', async (_req, res) => {
    try { res.json(await removeTrashed(ownerId(res))); }
    catch (error: unknown) { console.error('[trash] Błąd opróżniania:', errorMessage(error)); res.status(500).json({ error: 'Nie udało się opróżnić kosza.' }); }
  });
  router.post('/backfill-expiries', async (_req, res) => {
    try {
      const result = await backfillDocumentExpiriesFromOcr(prisma, ownerId(res));
      res.json(result);
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error('[POST /api/documents/backfill-expiries]', details);
      res.status(500).json(safeErrorPayload('Nie udało się przeskanować terminów z OCR.', details));
    }
  });
  router.post('/upload-resumable/init', async (req, res) => {
    try {
      const folderId = Number(req.body?.folderId);
      const totalChunks = Number(req.body?.totalChunks);
      if (!Number.isInteger(folderId) || folderId < 1 || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 2000) {
        return res.status(400).json({ error: 'Nieprawidłowe parametry inicjalizacji uploadu.' });
      }
      if (!await canAccessFolder(prisma, ownerId(res), folderId) || !await isDocumentFolder(prisma, folderId)) {
        return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do dostępnej kartoteki.' });
      }
      const session = initResumableSession({
        uploadId: typeof req.body?.uploadId === 'string' ? req.body.uploadId : undefined,
        ownerId: ownerId(res),
        folderId,
        fileName: String(req.body?.fileName || 'dokument.pdf'),
        mimeType: String(req.body?.mimeType || 'application/pdf'),
        totalChunks,
      });
      return res.json(session);
    } catch (error: unknown) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Błąd inicjalizacji uploadu.' });
    }
  });

  router.put('/upload-resumable/:uploadId/chunk/:index', (req, res) => {
    try {
      const data = typeof req.body?.data === 'string' ? req.body.data : '';
      if (!data) return res.status(400).json({ error: 'Brak danych części pliku.' });
      writeResumableChunk(req.params.uploadId, ownerId(res), Number(req.params.index), data);
      return res.json({ uploadId: req.params.uploadId, index: Number(req.params.index), received: true });
    } catch (error: unknown) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Błąd zapisu części pliku.' });
    }
  });

  router.post('/upload-resumable/:uploadId/complete', async (req, res) => {
    try {
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      const document = await completeResumableSession(prisma, req.params.uploadId, ownerId(res), res.locals.userId || null, plan);
      void enqueuePremiumOcr(prisma, ocrQueue, res, document.id);
      return res.json({ success: true, document });
    } catch (error: unknown) {
      if (error instanceof BusinessPlanRequiredError) return res.status(402).json({ code: error.code, error: error.message });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Błąd scalania pliku.' });
    }
  });

  router.use('/:id', async (req, res, next) => {
    if (req.method === 'POST' && (req.params.id === 'export-pdf' || req.params.id === 'upload-base64' || req.params.id === 'upload-binary')) return next();
    if (!/^\d+$/.test(req.params.id) || Number(req.params.id) < 1) return res.status(400).json({ error: 'Nieprawidłowy identyfikator dokumentu.' });
    const accessible = await getAccessibleFolderIds(prisma, ownerId(res));
    const document = await prisma.document.findFirst({ where: { id: Number(req.params.id), folderId: { in: accessible } } });
    if (!document) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
    res.locals.currentDocument = document;
    next();
  });

  router.get('/', async (req, res) => {
    try {
      const folderId = req.query.folderId;
      const accessible = await getAccessibleFolderIds(prisma, ownerId(res));
      const requestedFolderId = folderId ? Number(folderId) : null;
      if (requestedFolderId !== null && !accessible.includes(requestedFolderId)) return res.json([]);
      const where = requestedFolderId !== null ? { folderId: requestedFolderId } : { folderId: { in: accessible } };
      const records = await prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, filePath: true, mimeType: true, folderId: true, userId: true,
          thumbnail: true, retentionEnabled: true, retentionValue: true, retentionUnit: true,
          isArchived: true, isDeleted: true, deletedAt: true, physicalLocation: true,
          merchantName: true, amountCents: true, currency: true, dueDate: true, paymentStatus: true,
          createdAt: true, updatedAt: true,
          tags: { include: { tag: true } },
          user: { select: { name: true, email: true } },
        },
      });
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      const active = await activeDocumentIds(prisma, ownerId(res), plan);
      await prepareTags(prisma); const activeTags = await activeTagIds(prisma, ownerId(res), plan);
      res.json(records.map((document) => {
        let fileSize = 0;
        try { fileSize = fs.statSync(path.join(uploadsDir, document.filePath)).size; } catch {}
        return { ...document, fileSize, readOnly: active !== null && !active.has(document.id), tags: document.tags.map(entry => ({ ...entry, tag: { ...entry.tag, inactive: activeTags !== null && !activeTags.has(entry.tagId) } })) };
      }));
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error('[GET /api/documents] Błąd pobierania:', details);
      res.status(500).json(safeErrorPayload('Błąd pobierania dokumentów', details));
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: 'Nieprawidłowy identyfikator dokumentu.' });
      }
      const document = await prisma.document.findUnique({
        where: { id },
        include: { tags: { include: { tag: true } }, user: { select: { name: true, email: true } } },
      });
      if (!document) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });

      let fileSize = 0;
      try { fileSize = fs.statSync(path.join(uploadsDir, document.filePath)).size; } catch {}
      const { ocrText: _ocrText, ...metadata } = document;
      const plan = await getPlan(prisma, ocrOwnerKey(res)); const active = await activeDocumentIds(prisma, ownerId(res), plan);
      await prepareTags(prisma); const activeTags = await activeTagIds(prisma, ownerId(res), plan);
      return res.json({ ...metadata, fileSize, readOnly: active !== null && !active.has(document.id), tags: metadata.tags.map(entry => ({ ...entry, tag: { ...entry.tag, inactive: activeTags !== null && !activeTags.has(entry.tagId) } })) });
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error(`[GET /api/documents/${req.params.id}] Błąd pobierania:`, details);
      return res.status(500).json(safeErrorPayload('Błąd pobierania dokumentu', details));
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const update = documentUpdate(req.body);
      if (!Number.isInteger(id) || id < 1 || !update) return res.status(400).json({ error: 'Nieprawidłowe dane aktualizacji dokumentu.' });
      const { tagIds, ...data } = update;
      let destinationDigest: string | undefined;
      const current = res.locals.currentDocument as { isDeleted?: boolean; isArchived?: boolean } | undefined;
      const restoring = (current?.isDeleted && data.isDeleted === false) || (current?.isArchived && data.isArchived === false);
      const onlyTrash = data.isDeleted === true && Object.keys(data).every(key => key === 'isDeleted' || key === 'deletedAt') && tagIds === undefined;
      const onlyArchive = !current?.isDeleted && data.isArchived === true && Object.keys(data).every(key => key === 'isArchived' || key === 'retentionEnabled') && tagIds === undefined;
      const onlyMove = !restoring && !current?.isDeleted && !current?.isArchived && data.folderId !== undefined && Object.keys(data).every(key => key === 'folderId') && tagIds === undefined;
      const active = await activeDocumentIds(prisma, ownerId(res), await getPlan(prisma, ocrOwnerKey(res)));
      if (!onlyTrash && !onlyArchive && !onlyMove && active !== null && !active.has(id)) return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument przekracza limit planu. Możesz go przenieść, zarchiwizować albo usunąć. Aby go edytować lub udostępniać, zwolnij miejsce lub wybierz wyższy plan.' });
      if (restoring && data.folderId === undefined) return res.status(400).json({ error: 'Wybierz kartotekę, do której przywrócić dokument.' });
      if (data.folderId !== undefined) {
        const destinationId = Number(data.folderId);
        if (!await canAccessFolder(prisma, ownerId(res), destinationId) || !await isDocumentFolder(prisma, destinationId)) return res.status(400).json({ error: 'Wybierz dostępną kartotekę docelową.' });
        data.folderId = destinationId;
        const original = res.locals.currentDocument as { id: number; folderId: number; filePath: string };
        if (destinationId !== original.folderId || restoring) {
          try {
            destinationDigest = await hashFile(path.join(uploadsDir, path.basename(original.filePath)));
          } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
          }
        }
      }
      if (data.isDeleted === true && data.deletedAt === undefined) data.deletedAt = new Date();
      if (data.isDeleted === false) data.deletedAt = null;
      if (data.isArchived === true && data.retentionEnabled === undefined) data.retentionEnabled = false;
      let activeTags: Set<number> | null = null;
      if (Array.isArray(tagIds)) {
        await prepareTags(prisma); const allowedTags = new Set(await getOwnedTagIds(prisma, ownerId(res))); activeTags = await activeTagIds(prisma, ownerId(res), await getPlan(prisma, ocrOwnerKey(res)));
        if (tagIds.some((tagId: unknown) => !allowedTags.has(Number(tagId)))) return res.status(403).json({ error: 'Nie masz dostępu do wybranego tagu.' });
        if (activeTags && tagIds.some((tagId: unknown) => !activeTags!.has(Number(tagId)))) return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Ten tag jest nieaktywny w obecnym planie.' });
      }
      const updated = await prisma.$transaction(async tx => {
        if (destinationDigest) await assertUniqueDocument(tx, ownerId(res), Number(data.folderId), destinationDigest, id);
        if (Array.isArray(tagIds)) { const old = await tx.documentTag.findMany({ where: { documentId: id }, select: { tagId: true } }); const preserved = old.filter(entry => activeTags !== null && !activeTags.has(entry.tagId)).map(entry => entry.tagId); const merged = [...new Set([...preserved, ...tagIds.map(Number)])]; await tx.documentTag.deleteMany({ where: { documentId: id } }); if (merged.length) await tx.documentTag.createMany({ data: merged.map(tagId => ({ documentId: id, tagId })) }); }
        return tx.document.update({ where: { id }, data, include: { tags: { include: { tag: true } } } });
      });
      const { ocrText: _ocrText, ...metadata } = updated;
      res.json(metadata);
    } catch (error: unknown) {
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      const details = errorMessage(error);
      console.error(`[PATCH /api/documents/${req.params.id}] Błąd aktualizacji:`, details);
      res.status(500).json(safeErrorPayload('Błąd edycji dokumentu', details));
    }
  });

  router.delete('/:id', async (req, res) => {
    try { const result = await removeTrashed(ownerId(res), Number(req.params.id)); if (!result.deleted) return res.status(409).json({ error: 'Trwale usunąć można tylko dokument znajdujący się w koszu.' }); res.json({ success: true, ...result }); }
    catch (error: unknown) {
      const details = errorMessage(error);
      console.error(`[DELETE /api/documents/${req.params.id}] Błąd usuwania:`, details);
      res.status(500).json(safeErrorPayload('Błąd usuwania dokumentu', details));
    }
  });

  router.post('/upload-base64', async (req, res) => {
    try {
      const { files, folderId, physicalLocation, retentions } = req.body;
      if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'Nie wybrano żadnych plików.' });
      if (!Array.isArray(retentions)) return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji.' });
      if (files.some((file: unknown) => {
        if (!file || typeof file !== 'object') return true;
        const candidate = file as { name?: unknown; data?: unknown };
        if (typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.data !== 'string') return true;
        return !parseBase64DataUrl(candidate.data);
      })) return res.status(400).json({ error: 'Co najmniej jeden plik ma nieprawidłowy format.' });
      if (!await canAccessFolder(prisma, ownerId(res), Number(folderId)) || !await isDocumentFolder(prisma, folderId)) return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do dostępnej kartoteki.' });
      const ownerKey = ocrOwnerKey(res); const plan = await getPlan(prisma, ownerKey);
      if (req.body?.isMerge === true) {
        const title = typeof req.body.mergedTitle === 'string' ? req.body.mergedTitle.trim() : '';
        if (!title || title.length > 255) return res.status(400).json({ error: 'Podaj tytuł scalonego dokumentu.' });
        const retention = req.body.mergedRetention || {};
        const value = Number(retention.value);
        if (!Number.isInteger(value) || value < 1 || !retentionUnits.has(retention.unit) || typeof retention.enabled !== 'boolean') return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji.' });
        try {
          const saved = await saveMergedBase64Document(prisma, {
            owner: ownerId(res), userId: res.locals.userId || null, ownerKey, plan, folderId: Number(folderId),
            title, physicalLocation: physicalLocation || null, files, retention: { enabled: retention.enabled, value, unit: retention.unit },
          });
          void enqueuePremiumOcr(prisma, ocrQueue, res, saved.id);
          return res.json({ success: true, savedDocs: [saved] });
        } catch (error) {
          if (error instanceof UnsupportedMergeFormat) return res.status(400).json({ error: error.message });
          throw error;
        }
      }
      const { savedDocs, skippedDuplicates } = await saveBatchBase64Documents(prisma, {
        owner: ownerId(res), userId: res.locals.userId || null, plan, folderId: Number(folderId),
        physicalLocation: physicalLocation || null, files, retentions,
      });
      for (const saved of savedDocs) {
        if (saved.mimeType === 'application/xml' || saved.mimeType === 'text/xml' || saved.mimeType === 'application/json' || saved.ocrText) continue;
        void enqueuePremiumOcr(prisma, ocrQueue, res, saved.id);
      }
      res.json({ success: true, savedDocs, skippedDuplicates });
    } catch (error: unknown) {
      if (error instanceof BusinessPlanRequiredError) return res.status(402).json({ code: error.code, error: error.message });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      const details = errorMessage(error);
      console.error('[POST /api/documents/upload-base64] Błąd dekodowania:', details);
      res.status(500).json(safeErrorPayload(process.env.NODE_ENV === 'production' || !details ? 'Błąd wgrywania Base64' : `Błąd wgrywania Base64: ${details}`, details));
    }
  });

  const binaryUpload = multer({ storage: multer.memoryStorage(), limits: { files: 50, fileSize: 50 * 1024 * 1024 } });

  router.post('/upload-binary', binaryUpload.array('files', 50), async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'Nie wybrano żadnych plików.' });
      const folderId = Number(req.body?.folderId);
      if (!await canAccessFolder(prisma, ownerId(res), folderId) || !await isDocumentFolder(prisma, folderId)) {
        return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do dostępnej kartoteki.' });
      }
      let retentions: unknown;
      let thumbnails: unknown;
      try {
        retentions = JSON.parse(String(req.body?.retentions || '[]'));
        thumbnails = JSON.parse(String(req.body?.thumbnails || '[]'));
      } catch {
        return res.status(400).json({ error: 'Nieprawidłowy format JSON dla retencji lub miniatur.' });
      }
      if (!Array.isArray(retentions) || !Array.isArray(thumbnails)) {
        return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji lub miniatur.' });
      }
      for (const item of retentions) {
        if (!item || typeof item !== 'object') return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji.' });
        const r = item as { enabled?: unknown; value?: unknown; unit?: unknown };
        const val = Number(r.value ?? 5);
        const unit = String(r.unit ?? 'years');
        if (r.enabled !== undefined && typeof r.enabled !== 'boolean') return res.status(400).json({ error: 'Nieprawidłowa flaga retencji.' });
        if (!Number.isInteger(val) || val < 1 || val > 1000 || !retentionUnits.has(unit)) {
          return res.status(400).json({ error: 'Nieprawidłowa wartość lub jednostka retencji.' });
        }
      }
      const physicalLocation = req.body?.physicalLocation ? String(req.body.physicalLocation) : null;
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      const { savedDocs, skippedDuplicates } = await saveBatchBinaryDocuments(prisma, {
        owner: ownerId(res), userId: res.locals.userId || null, plan, folderId, physicalLocation,
        files: files.map(f => ({ originalname: f.originalname, mimetype: f.mimetype, buffer: f.buffer })),
        retentions: Array.isArray(retentions) ? retentions : [],
        thumbnails: Array.isArray(thumbnails) ? thumbnails : [],
      });
      for (const saved of savedDocs) {
        if (saved.mimeType === 'application/xml' || saved.mimeType === 'text/xml' || saved.mimeType === 'application/json' || saved.ocrText) continue;
        void enqueuePremiumOcr(prisma, ocrQueue, res, saved.id);
      }
      return res.json({ success: true, savedDocs, skippedDuplicates });
    } catch (error: unknown) {
      if (error instanceof BusinessPlanRequiredError) return res.status(402).json({ code: error.code, error: error.message });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      const details = errorMessage(error);
      console.error('[POST /api/documents/upload-binary]', details);
      return res.status(500).json(safeErrorPayload(process.env.NODE_ENV === 'production' || !details ? 'Błąd wgrywania' : `Błąd wgrywania: ${details}`, details));
    }
  });

  router.use(createDocumentExportRouter(prisma, ownerId));
  return router;
}
