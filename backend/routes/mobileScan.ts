import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import type { PrismaClient } from '@prisma/client';
import { scanDraftsDir, uploadsDir } from '../config/paths';
import { errorMessage } from '../utils/errors';
import { enqueuePremiumOcr } from '../services/ocrEnqueue';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan, ensurePlanLedger, checkDocumentCapacity, consumeUsage, claimPrinterPages, PlanLimitError } from '../services/planLedger';
import { createHash, randomUUID } from 'node:crypto';
import { assertUniqueDocument, DuplicateDocumentError, hashFile } from '../services/duplicateDocuments';
import { prepareScannedPdf } from '../services/scannedPdfArchive';
import type { createOcrQueue } from '../services/ocrQueue';
// @ts-ignore - multer is used without bundled TypeScript declarations.
import multer from 'multer';

type UploadedFile = { path: string; filename: string; mimetype: string };
type ScanRequest = Request & { body: Record<string, unknown>; file?: UploadedFile; files?: UploadedFile[] | Record<string, UploadedFile[]> };
type StorageCallback = (error: Error | null, value: string) => void;

const RETENTION_UNITS = ['years', 'months', 'days', 'minutes'];
const validDraftId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const getDraftDir = (draftId: string) => path.join(scanDraftsDir, draftId);

/** Phone scan upload, temporary pages and PDF finalization. */
export function createMobileScanRouter(prisma: PrismaClient, ocrQueue?: ReturnType<typeof createOcrQueue>) {
  const router = express.Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req: Request, _file: Express.Multer.File, cb: StorageCallback) => cb(null, uploadsDir),
      filename: (_req: Request, _file: Express.Multer.File, cb: StorageCallback) => cb(null, 'SCAN_' + randomUUID() + '.jpg'),
    }),
    limits: { files: 50, fileSize: 50 * 1024 * 1024 },
  });

  router.post('/mobile-scan', upload.single('file'), async (req: ScanRequest, res: Response) => {
    try {
      if (!req.file || !req.body.folderId) return res.status(400).json({ error: 'Brak pliku lub folderId' });
      if (!await prisma.folder.findFirst({ where: { id: Number(req.body.folderId), ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })) return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
      const retentionValue = Number(req.body.retentionValue);
      const retentionUnit = String(req.body.retentionUnit || 'years');
      if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
      }
      const uploadedFile = req.file;
      const key = ocrOwnerKey(res); const plan = await getPlan(prisma, key); await ensurePlanLedger(prisma);
      const digest = await hashFile(uploadedFile.path);
      const document = await prisma.$transaction(async tx => { await assertUniqueDocument(tx, Number(res.locals.userId || 1), Number(req.body.folderId), digest); await checkDocumentCapacity(tx, Number(res.locals.userId || 1), plan, 1); await consumeUsage(tx, key, plan, 'cameraScan', randomUUID(), 1); return tx.document.create({ data: {
        title: String(req.body.title).slice(0, 255), filePath: uploadedFile.filename, folderId: Number(req.body.folderId), mimeType: 'image/jpeg',
        retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
      } }); });
      void enqueuePremiumOcr(prisma, ocrQueue, res, document.id);
      res.status(200).json(document);
    } catch (error: unknown) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      const details = errorMessage(error);
      console.error('[/api/mobile-scan] BŁĄD:', details);
      res.status(500).json({ error: 'Błąd bazy danych podczas zapisu skanu', details });
    }
  });

  router.post('/mobile-scan-document', upload.array('files', 50), async (req: ScanRequest, res: Response) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const removeTemporaryFiles = () => files.forEach((file) => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    let outputPath = '';
    try {
      if (!files.length || !req.body.folderId) return res.status(400).json({ error: 'Dodaj co najmniej jedną stronę i wybierz kartotekę.' });
      if (!await prisma.folder.findFirst({ where: { id: Number(req.body.folderId), ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })) return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
      const retentionValue = Number(req.body.retentionValue);
      const retentionUnit = String(req.body.retentionUnit || 'years');
      if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
        removeTemporaryFiles();
        return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
      }
      const pdf = await PDFDocument.create();
      for (const file of files) {
        const bytes = fs.readFileSync(file.path);
        const image = file.mimetype === 'image/png' ? await pdf.embedPng(new Uint8Array(bytes)) : await pdf.embedJpg(new Uint8Array(bytes));
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const filename = 'SCAN_DOCUMENT_' + randomUUID() + '.pdf';
      const archive = await prepareScannedPdf(await pdf.save());
      outputPath = path.join(uploadsDir, filename); fs.writeFileSync(outputPath, archive.bytes, { flag: 'wx' });
      removeTemporaryFiles();
      const key = ocrOwnerKey(res); const plan = await getPlan(prisma, key); await ensurePlanLedger(prisma);
      const digest = await hashFile(outputPath);
      const document = await prisma.$transaction(async tx => { await assertUniqueDocument(tx, Number(res.locals.userId || 1), Number(req.body.folderId), digest); await checkDocumentCapacity(tx, Number(res.locals.userId || 1), plan, 1); await consumeUsage(tx, key, plan, 'cameraScan', randomUUID(), files.length); if (files.length > 1) await consumeUsage(tx, key, plan, 'merge', randomUUID(), 1); return tx.document.create({ data: {
        title: String(req.body.title).slice(0, 255), filePath: filename, folderId: Number(req.body.folderId), mimeType: 'application/pdf',
        retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
      } }); });
      outputPath = '';
      void enqueuePremiumOcr(prisma, ocrQueue, res, document.id);
      res.status(201).json({ ...document, pdfa: archive.pdfa, pdfaWarning: archive.warning });
    } catch (error: unknown) {
      removeTemporaryFiles();
      if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      console.error('[/api/mobile-scan-document] BŁĄD:', errorMessage(error));
      res.status(500).json({ error: 'Nie udało się scalić dokumentu do PDF.' });
    }
  });

  router.post('/mobile-scan-draft/page', upload.single('file'), (req: ScanRequest, res: Response) => {
    const draftId = req.body?.draftId;
    const pageNumber = Number(req.body?.pageNumber);
    const removeIncomingFile = () => { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); };
    try {
      if (!req.file || !validDraftId(draftId) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 50) {
        removeIncomingFile();
        return res.status(400).json({ error: 'Nieprawidłowa strona wersji roboczej.' });
      }
      const draftDir = getDraftDir(draftId);
      fs.mkdirSync(draftDir, { recursive: true });
      const destination = path.join(draftDir, 'page-' + String(pageNumber).padStart(3, '0') + '.jpg');
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
      fs.renameSync(req.file.path, destination);
      res.status(201).json({ pageNumber });
    } catch (error: unknown) {
      removeIncomingFile();
      console.error('[/api/mobile-scan-draft/page] BŁĄD:', errorMessage(error));
      res.status(500).json({ error: 'Nie udało się odebrać strony skanu.' });
    }
  });

  router.post('/mobile-scan-draft/finalize', async (req: ScanRequest, res: Response) => {
    const { draftId, folderId, title, retentionValue: rawRetentionValue, retentionUnit = 'years', retentionEnabled = false, thumbnail } = req.body || {};
    let outputPath = '';
    try {
      const retentionValue = Number(rawRetentionValue);
      if (!validDraftId(draftId) || !folderId || !title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(String(retentionUnit))) {
        return res.status(400).json({ error: 'Nieprawidłowe dane dokumentu.' });
      }
      if (!await prisma.folder.findFirst({ where: { id: Number(folderId), ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })) return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
      const key = ocrOwnerKey(res); const plan = await getPlan(prisma, key); await ensurePlanLedger(prisma);
      const pageKeys: unknown = req.body?.pageKeys ?? [];
      if (!Array.isArray(pageKeys) || pageKeys.length > 50 || pageKeys.some(item => typeof item !== 'string' || item.length > 255)) return res.status(400).json({ error: 'Nieprawidłowa lista stron.' });
      const fingerprint = createHash('sha256').update(JSON.stringify({ folderId: Number(folderId), title: String(title), retentionValue, retentionUnit, retentionEnabled: Boolean(retentionEnabled), pageKeys })).digest('hex');
      const receipts = await prisma.$queryRaw<Array<{ documentId: number; fingerprint: string }>>`SELECT documentId, fingerprint FROM PlanScanReceipt WHERE ownerKey = ${key} AND draftId = ${String(draftId)}`;
      if (receipts.length) {
        if (receipts[0].fingerprint !== fingerprint) return res.status(409).json({ error: 'Ta wersja robocza została już zapisana z innymi ustawieniami.' });
        const existing = await prisma.document.findFirst({ where: { id: Number(receipts[0].documentId), folder: { ownerId: Number(res.locals.userId || 1) } } });
        if (!existing) return res.status(409).json({ error: 'Wersja robocza została już zapisana, ale dokument nie jest już dostępny.' });
        try { fs.rmSync(getDraftDir(draftId), { recursive: true, force: true }); } catch { console.error('[scan] Nie udało się usunąć ponowionego szkicu.'); }
        return res.status(200).json(existing);
      }
      const draftDir = getDraftDir(draftId);
      if (!fs.existsSync(draftDir)) return res.status(400).json({ error: 'Nie znaleziono wersji roboczej na komputerze.' });
      const pagePaths = fs.readdirSync(draftDir).filter((name) => /^page-\d{3}\.jpg$/.test(name)).sort().map((name) => path.join(draftDir, name));
      if (!pagePaths.length) return res.status(400).json({ error: 'Wersja robocza nie zawiera stron.' });
      if (pageKeys.length && pageKeys.length !== pagePaths.length) return res.status(400).json({ error: 'Liczba przesłanych stron nie zgadza się ze szkicem.' });
      const pdf = await PDFDocument.create();
      for (const pagePath of pagePaths) {
        const image = await pdf.embedJpg(new Uint8Array(fs.readFileSync(pagePath)));
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const filename = 'SCAN_DOCUMENT_' + randomUUID() + '.pdf';
      const archive = await prepareScannedPdf(await pdf.save());
      outputPath = path.join(uploadsDir, filename); fs.writeFileSync(outputPath, archive.bytes, { flag: 'wx' });
      const printerJobs: unknown = req.body?.printerJobs ?? [];
      if (!Array.isArray(printerJobs) || printerJobs.length > pagePaths.length || printerJobs.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) { fs.unlinkSync(outputPath); return res.status(400).json({ error: 'Nieprawidłowe strony drukarki.' }); }
      const digest = await hashFile(outputPath);
      const document = await prisma.$transaction(async tx => { await assertUniqueDocument(tx, Number(res.locals.userId || 1), Number(folderId), digest); await checkDocumentCapacity(tx, Number(res.locals.userId || 1), plan, 1); const printerCount = await claimPrinterPages(tx, key, String(draftId), printerJobs as string[]); const cameraPages = pagePaths.length - printerCount; if (cameraPages) await consumeUsage(tx, key, plan, 'cameraScan', String(draftId), cameraPages); if (pagePaths.length > 1) await consumeUsage(tx, key, plan, 'merge', String(draftId), 1); const saved = await tx.document.create({ data: {
        title: String(title).slice(0, 255), filePath: filename, folderId: Number(folderId), mimeType: 'application/pdf',
        retentionEnabled: Boolean(retentionEnabled), retentionValue, retentionUnit: String(retentionUnit),
        thumbnail: typeof thumbnail === 'string' && /^data:image\/jpeg;base64,/.test(thumbnail) && thumbnail.length <= 300_000 ? thumbnail : null,
      } }); await tx.$executeRaw`INSERT INTO PlanScanReceipt(ownerKey,draftId,documentId,fingerprint) VALUES (${key},${String(draftId)},${saved.id},${fingerprint})`; return saved; });
      outputPath = '';
      void enqueuePremiumOcr(prisma, ocrQueue, res, document.id);
      try { fs.rmSync(draftDir, { recursive: true, force: true }); } catch (error) { console.error('[scan] Nie udało się usunąć szkicu:', errorMessage(error)); }
      res.status(201).json({ ...document, pdfa: archive.pdfa, pdfaWarning: archive.warning });
    } catch (error: unknown) {
      if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
      if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
      console.error('[/api/mobile-scan-draft/finalize] BŁĄD:', errorMessage(error));
      res.status(500).json({ error: 'Nie udało się scalić dokumentu do PDF.' });
    }
  });
  return router;
}
