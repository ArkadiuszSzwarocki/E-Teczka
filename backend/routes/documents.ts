import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { isDocumentFolder } from '../services/folders';
import { errorMessage } from '../utils/errors';
import { hasPremium } from '../middleware/premium';
import { PDFDocument } from 'pdf-lib';
import { enqueuePremiumOcr } from '../services/ocrEnqueue';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan, ensurePlanLedger, checkDocumentCapacity, consumeUsage, PlanLimitError } from '../services/planLedger';
import type { createOcrQueue } from '../services/ocrQueue';
import { mergeDocuments, UnsupportedMergeFormat } from '../services/mergeDocuments';
import { parseBase64DataUrl } from '../services/base64DataUrl';
import { prepareTags, tagIds as getOwnedTagIds } from '../services/tagOwnership';
import { activeDocumentIds, activeTagIds } from '../services/planRestrictions';
import { assertUniqueDocument, DuplicateDocumentError, hashBuffer, hashFile } from '../services/duplicateDocuments';

const retentionUnits = new Set(['years', 'months', 'days', 'minutes']);

function documentUpdate(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  const allowed = new Set(['title', 'folderId', 'retentionEnabled', 'retentionValue', 'retentionUnit', 'isArchived', 'isDeleted', 'deletedAt', 'tagIds']);
  if (Object.keys(source).some((key) => !allowed.has(key))) return null;
  if (source.title !== undefined && (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 255)) return null;
  if (source.folderId !== undefined && (!Number.isInteger(Number(source.folderId)) || Number(source.folderId) < 1)) return null;
  if (source.retentionEnabled !== undefined && typeof source.retentionEnabled !== 'boolean') return null;
  if (source.retentionValue !== undefined && (!Number.isInteger(Number(source.retentionValue)) || Number(source.retentionValue) < 1)) return null;
  if (source.retentionUnit !== undefined && (typeof source.retentionUnit !== 'string' || !retentionUnits.has(source.retentionUnit))) return null;
  if (source.isArchived !== undefined && typeof source.isArchived !== 'boolean') return null;
  if (source.isDeleted !== undefined && typeof source.isDeleted !== 'boolean') return null;
  if (source.deletedAt !== undefined && source.deletedAt !== null && typeof source.deletedAt !== 'string') return null;
  if (source.createdAt !== undefined && (typeof source.createdAt !== 'string' || Number.isNaN(new Date(source.createdAt).getTime()))) return null;
  if (source.tagIds !== undefined && (!Array.isArray(source.tagIds) || source.tagIds.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1))) return null;
  return source;
}

/** Document listing, metadata changes and desktop Base64 uploads. */
export function createDocumentRouter(prisma: PrismaClient, ocrQueue?: ReturnType<typeof createOcrQueue>) {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
  // Delete only records currently in this owner's trash; shared file paths remain intact.
  const removeTrashed = async (owner: number, id?: number) => {
    const where = { isDeleted: true, folder: { ownerId: owner }, ...(id === undefined ? {} : { id }) };
    const records = await prisma.document.findMany({ where, select: { id: true, filePath: true } });
    const ids = records.map(record => record.id);
    if (ids.length) await prisma.$transaction(async tx => {
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
  router.post('/empty-trash', async (_req, res) => {
    try { res.json(await removeTrashed(ownerId(res))); }
    catch (error: unknown) { console.error('[trash] Błąd opróżniania:', errorMessage(error)); res.status(500).json({ error: 'Nie udało się opróżnić kosza.' }); }
  });
  router.use('/:id', async (req, res, next) => {
    if (req.method === 'POST' && (req.params.id === 'export-pdf' || req.params.id === 'upload-base64')) return next();
    if (!/^\d+$/.test(req.params.id) || Number(req.params.id) < 1) return res.status(400).json({ error: 'Nieprawidłowy identyfikator dokumentu.' });
    const document = await prisma.document.findFirst({ where: { id: Number(req.params.id), folder: { ownerId: ownerId(res) } } });
    if (!document) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
    res.locals.currentDocument = document;
    next();
  });

  router.get('/', async (req, res) => {
    try {
      const folderId = req.query.folderId;
      const where = folderId ? { folderId: Number(folderId), folder: { ownerId: ownerId(res) } } : { folder: { ownerId: ownerId(res) } };
      const records = await prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { tags: { include: { tag: true } }, user: { select: { name: true, email: true } } },
      });
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      const active = await activeDocumentIds(prisma, ownerId(res), plan);
      await prepareTags(prisma); const activeTags = await activeTagIds(prisma, ownerId(res), plan);
      res.json(records.map((document) => {
        let fileSize = 0;
        try { fileSize = fs.statSync(path.join(uploadsDir, document.filePath)).size; } catch {}
        const { ocrText: _ocrText, ...metadata } = document;
        return { ...metadata, fileSize, readOnly: active !== null && !active.has(document.id), tags: metadata.tags.map(entry => ({ ...entry, tag: { ...entry.tag, inactive: activeTags !== null && !activeTags.has(entry.tagId) } })) };
      }));
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error('[GET /api/documents] Błąd pobierania:', details);
      res.status(500).json({ error: 'Błąd pobierania dokumentów', details });
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
      return res.status(500).json({ error: 'Błąd pobierania dokumentu', details });
    }
  });

  router.patch('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const update = documentUpdate(req.body);
      if (!Number.isInteger(id) || id < 1 || !update) return res.status(400).json({ error: 'Nieprawidłowe dane aktualizacji dokumentu.' });
      const { tagIds, ...data } = update;
      let destinationDigest: string | undefined;
      const onlyTrash = data.isDeleted === true && Object.keys(data).every(key => key === 'isDeleted' || key === 'deletedAt') && tagIds === undefined;
      const active = await activeDocumentIds(prisma, ownerId(res), await getPlan(prisma, ocrOwnerKey(res)));
      if (!onlyTrash && active !== null && !active.has(id)) return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument przekracza limit planu. Możesz go otworzyć, pobrać albo usunąć. Aby go edytować, zwolnij miejsce lub wybierz wyższy plan.' });
      const current = res.locals.currentDocument as { isDeleted?: boolean; isArchived?: boolean } | undefined;
      const restoring = (current?.isDeleted && data.isDeleted === false) || (current?.isArchived && data.isArchived === false);
      if (restoring && data.folderId === undefined) return res.status(400).json({ error: 'Wybierz podkartotekę, do której przywrócić dokument.' });
      if (data.folderId !== undefined) {
        const destinationId = Number(data.folderId);
        const destination = await prisma.folder.findFirst({ where: { id: destinationId, ownerId: ownerId(res) }, select: { parentId: true } });
        if (!destination || !destination.parentId) return res.status(400).json({ error: 'Wybierz własną podkartotekę docelową.' });
        data.folderId = destinationId;
        const original = res.locals.currentDocument as { id: number; folderId: number; filePath: string };
        if (destinationId !== original.folderId || restoring) destinationDigest = await hashFile(path.join(uploadsDir, path.basename(original.filePath)));
      }
      if (data.isDeleted === true && data.deletedAt === undefined) data.deletedAt = new Date();
      if (data.isDeleted === false) data.deletedAt = null;
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
      res.status(500).json({ error: 'Błąd edycji dokumentu', details });
    }
  });

  router.delete('/:id', async (req, res) => {
    try { const result = await removeTrashed(ownerId(res), Number(req.params.id)); if (!result.deleted) return res.status(409).json({ error: 'Trwale usunąć można tylko dokument znajdujący się w koszu.' }); res.json({ success: true, ...result }); }
    catch (error: unknown) {
      const details = errorMessage(error);
      console.error(`[DELETE /api/documents/${req.params.id}] Błąd usuwania:`, details);
      res.status(500).json({ error: 'Błąd usuwania dokumentu', details });
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
      const targetFolder = await prisma.folder.findFirst({ where: { id: Number(folderId), ownerId: ownerId(res) } });
      if (!targetFolder || !await isDocumentFolder(prisma, folderId)) return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do własnej podkartoteki.' });
      const ownerKey = ocrOwnerKey(res); const plan = await getPlan(prisma, ownerKey);
      if (req.body?.isMerge === true) {
        await ensurePlanLedger(prisma);
        const title = typeof req.body.mergedTitle === 'string' ? req.body.mergedTitle.trim() : '';
        if (!title || title.length > 255) return res.status(400).json({ error: 'Podaj tytuł scalonego dokumentu.' });
        let merged: Uint8Array;
        try { merged = await mergeDocuments(files); }
        catch (error) { if (error instanceof UnsupportedMergeFormat) return res.status(400).json({ error: error.message }); throw error; }
        const retention = req.body.mergedRetention || {};
        const value = Number(retention.value);
        if (!Number.isInteger(value) || value < 1 || !retentionUnits.has(retention.unit) || typeof retention.enabled !== 'boolean') return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji.' });
        const filename = `${Date.now()}-${randomUUID()}.pdf`;
        const destination = path.join(uploadsDir, filename);
        fs.writeFileSync(destination, merged, { flag: 'wx' });
        try {
          const saved = await prisma.$transaction(async tx => { await assertUniqueDocument(tx, ownerId(res), Number(folderId), hashBuffer(merged)); await checkDocumentCapacity(tx, ownerId(res), plan, 1); await consumeUsage(tx, ownerKey, plan, 'merge', randomUUID(), 1); return tx.document.create({ data: { title, filePath: filename, mimeType: 'application/pdf', folderId: Number(folderId), physicalLocation: physicalLocation || null, retentionEnabled: retention.enabled, retentionValue: value, retentionUnit: retention.unit, userId: res.locals.userId || null } }); });
          void enqueuePremiumOcr(prisma, ocrQueue, res, saved.id);
          return res.json({ success: true, savedDocs: [saved] });
        } catch (error) {
          fs.unlinkSync(destination);
          throw error;
        }
      }
      const writtenFiles: string[] = [];
      const skippedDuplicates: Array<{ name: string; existingTitle: string }> = [];
      let savedDocs;
      try {
        savedDocs = await prisma.$transaction(async tx => {
          const documents = [];
          for (let i = 0; i < files.length; i++) {
        const file = files[i]; const retention = retentions[i] || {};
        const retentionEnabled = retention.enabled !== false;
        const retentionValue = Number(retention.value) || 5;
        const retentionUnit = ['years', 'months', 'days', 'minutes'].includes(retention.unit) ? retention.unit : 'years';
        const decoded = parseBase64DataUrl(file.data);
        if (!decoded) throw new Error('Nieprawidłowe dane pliku.');
        const content = Buffer.from(decoded.base64, 'base64');
        try { await assertUniqueDocument(tx, ownerId(res), Number(folderId), hashBuffer(content)); }
        catch (error) { if (error instanceof DuplicateDocumentError) { skippedDuplicates.push({ name: file.name, existingTitle: error.existingTitle }); continue; } throw error; }
        await checkDocumentCapacity(tx, ownerId(res), plan, 1);
        const extension = path.extname(file.name).toLowerCase();
        const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
        const filename = `${randomUUID()}${safeExtension}`;
        const destination = path.join(uploadsDir, filename);
        fs.writeFileSync(destination, content, { flag: 'wx' });
        writtenFiles.push(destination);
        const saved = await tx.document.create({ data: {
            title: file.name, filePath: filename, mimeType: decoded.mimeType, folderId: Number(folderId),
            physicalLocation: physicalLocation || null, retentionEnabled, retentionValue, retentionUnit,
            thumbnail: file.thumbnail || null, userId: res.locals.userId || null,
        } });
        documents.push(saved);
          }
          return documents;
        });
      } catch (error) {
        for (const destination of writtenFiles) {
          try { fs.unlinkSync(destination); } catch (cleanupError) { console.error('[upload] Nie udało się usunąć pliku po błędzie zapisu:', errorMessage(cleanupError)); }
        }
        throw error;
      }
      for (const saved of savedDocs) void enqueuePremiumOcr(prisma, ocrQueue, res, saved.id);
      res.json({ success: true, savedDocs, skippedDuplicates });
    } catch (error: unknown) {
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      const details = errorMessage(error);
      console.error('[POST /api/documents/upload-base64] Błąd dekodowania:', details);
      res.status(500).json({ error: 'Błąd wgrywania Base64', details });
    }
  });

  router.post('/export-pdf', async (req, res) => {
    try {
      if (!await hasPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Eksport grupowy wymaga planu Premium.' });
      const ids = Array.isArray(req.body?.documentIds) ? req.body.documentIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0) : [];
      if (!ids.length || ids.length > 100) return res.status(400).json({ error: 'Wybierz od 1 do 100 dokumentów.' });
      const records = await prisma.document.findMany({ where: { id: { in: ids }, folder: { ownerId: ownerId(res) } } });
      if (records.length !== ids.length) return res.status(403).json({ error: 'Nie masz dostępu do wszystkich wybranych dokumentów.' });
      const output = await PDFDocument.create();
      for (const record of records) {
        const file = fs.readFileSync(path.join(uploadsDir, record.filePath));
        if (record.mimeType.includes('pdf') || record.filePath.toLowerCase().endsWith('.pdf')) {
          const source = await PDFDocument.load(file);
          const pages = await output.copyPages(source, source.getPageIndices());
          pages.forEach(page => output.addPage(page));
        } else if (record.mimeType.includes('png') || record.filePath.toLowerCase().endsWith('.png')) {
          const image = await output.embedPng(file); const page = output.addPage([image.width, image.height]); page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        } else {
          const image = await output.embedJpg(file); const page = output.addPage([image.width, image.height]); page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        }
      }
      const bytes = await output.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="eteczka-eksport-${Date.now()}.pdf"`);
      res.send(Buffer.from(bytes));
    } catch (error: unknown) { res.status(500).json({ error: 'Nie udało się utworzyć połączonego PDF-a.', details: errorMessage(error) }); }
  });
  return router;
}
