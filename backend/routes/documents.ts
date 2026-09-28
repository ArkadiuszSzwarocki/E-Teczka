import express from 'express';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { isDocumentFolder } from '../services/folders';
import { errorMessage } from '../utils/errors';
import { hasPremium } from '../middleware/premium';
import { PDFDocument } from 'pdf-lib';
import { createWorker } from 'tesseract.js';

const retentionUnits = new Set(['years', 'months', 'days', 'minutes']);

async function recognizeDocument(prisma: PrismaClient, documentId: number, filePath: string) {
  const worker = await createWorker('pol+eng');
  try {
    const result = await worker.recognize(filePath);
    await prisma.document.update({ where: { id: documentId }, data: { ocrText: result.data.text.slice(0, 100_000) } });
  } finally { await worker.terminate(); }
}

function documentUpdate(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  const allowed = new Set(['title', 'folderId', 'retentionEnabled', 'retentionValue', 'retentionUnit', 'isArchived', 'isDeleted', 'deletedAt', 'createdAt', 'tagIds']);
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
export function createDocumentRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);
  router.use('/:id', async (req, res, next) => {
    if (req.params.id === 'export-pdf') return next();
    const document = await prisma.document.findFirst({ where: { id: Number(req.params.id), folder: { ownerId: ownerId(res) } } });
    if (!document) return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
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
      res.json(records.map((document) => {
        let fileSize = 0;
        try { fileSize = fs.statSync(path.join(uploadsDir, document.filePath)).size; } catch {}
        return { ...document, fileSize };
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
      return res.json({ ...document, fileSize });
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
      if (data.isDeleted === true && data.deletedAt === undefined) data.deletedAt = new Date();
      if (data.isDeleted === false) data.deletedAt = null;
      if (Array.isArray(tagIds)) {
        await prisma.documentTag.deleteMany({ where: { documentId: id } });
        if (tagIds.length) await prisma.documentTag.createMany({ data: tagIds.map((tagId: unknown) => ({ documentId: id, tagId: Number(tagId) })) });
      }
      res.json(await prisma.document.update({ where: { id }, data, include: { tags: { include: { tag: true } } } }));
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error(`[PATCH /api/documents/${req.params.id}] Błąd aktualizacji:`, details);
      res.status(500).json({ error: 'Błąd edycji dokumentu', details });
    }
  });

  router.delete('/:id', async (req, res) => {
    try { await prisma.document.delete({ where: { id: Number(req.params.id) } }); res.json({ success: true }); }
    catch (error: unknown) {
      const details = errorMessage(error);
      console.error(`[DELETE /api/documents/${req.params.id}] Błąd usuwania:`, details);
      res.status(500).json({ error: 'Błąd usuwania dokumentu', details });
    }
  });

  router.post('/upload-base64', async (req, res) => {
    try {
      const { files, folderId, physicalLocation, retentions } = req.body;
      if (req.body?.feature === 'printer-scan' && !await hasPremium(prisma, res)) return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Skanowanie z drukarki wymaga planu Premium.' });
      const targetFolder = await prisma.folder.findFirst({ where: { id: Number(folderId), ownerId: ownerId(res) } });
      if (!targetFolder || !await isDocumentFolder(prisma, folderId)) return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do własnej podkartoteki.' });
      const savedDocs = [];
      const premium = await hasPremium(prisma, res);
      for (let i = 0; i < files.length; i++) {
        const file = files[i]; const retention = retentions[i] || {};
        const retentionEnabled = retention.enabled !== false;
        const retentionValue = Number(retention.value) || 5;
        const retentionUnit = ['years', 'months', 'days', 'minutes'].includes(retention.unit) ? retention.unit : 'years';
        const matches = file.data.match(/^data:([A-Za-z-+\\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) continue;
        const ext = file.name.split('.').pop() || 'jpg';
        const filename = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
        fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(matches[2], 'base64'));
        const saved = await prisma.document.create({ data: {
          title: file.name, filePath: filename, mimeType: matches[1], folderId: Number(folderId),
          physicalLocation: physicalLocation || null, retentionEnabled, retentionValue, retentionUnit,
          thumbnail: file.thumbnail || null, userId: res.locals.userId || null,
        } });
        savedDocs.push(saved);
        if (premium) void recognizeDocument(prisma, saved.id, path.join(uploadsDir, filename)).catch(error => console.error('[ocr] Błąd:', error));
      }
      res.json({ success: true, savedDocs });
    } catch (error: unknown) {
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
