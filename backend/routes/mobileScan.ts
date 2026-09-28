import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import type { PrismaClient } from '@prisma/client';
import { scanDraftsDir, uploadsDir } from '../config/paths';
import { isDocumentFolder } from '../services/folders';
import { errorMessage } from '../utils/errors';
// @ts-ignore - multer is used without bundled TypeScript declarations.
import multer from 'multer';

type UploadedFile = { path: string; filename: string; mimetype: string };
type ScanRequest = Request & { body: Record<string, unknown>; file?: UploadedFile; files?: UploadedFile[] | Record<string, UploadedFile[]> };
type StorageCallback = (error: Error | null, value: string) => void;

const RETENTION_UNITS = ['years', 'months', 'days', 'minutes'];
const validDraftId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const getDraftDir = (draftId: string) => path.join(scanDraftsDir, draftId);

/** Phone scan upload, temporary pages and PDF finalization. */
export function createMobileScanRouter(prisma: PrismaClient) {
  const router = express.Router();
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req: Request, _file: Express.Multer.File, cb: StorageCallback) => cb(null, uploadsDir),
      filename: (_req: Request, _file: Express.Multer.File, cb: StorageCallback) => cb(null, 'SCAN_' + Date.now() + '.jpg'),
    }),
    limits: { files: 50, fileSize: 50 * 1024 * 1024 },
  });

  router.post('/mobile-scan', upload.single('file'), async (req: ScanRequest, res: Response) => {
    try {
      if (!req.file || !req.body.folderId) return res.status(400).json({ error: 'Brak pliku lub folderId' });
      if (!await isDocumentFolder(prisma, req.body.folderId)) return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do podkartotek.' });
      const retentionValue = Number(req.body.retentionValue);
      const retentionUnit = String(req.body.retentionUnit || 'years');
      if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
      }
      const document = await prisma.document.create({ data: {
        title: String(req.body.title).slice(0, 255), filePath: req.file.filename, folderId: Number(req.body.folderId), mimeType: 'image/jpeg',
        retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
      } });
      res.status(200).json(document);
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error('[/api/mobile-scan] BŁĄD:', details);
      res.status(500).json({ error: 'Błąd bazy danych podczas zapisu skanu', details });
    }
  });

  router.post('/mobile-scan-document', upload.array('files', 50), async (req: ScanRequest, res: Response) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const removeTemporaryFiles = () => files.forEach((file) => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    try {
      if (!files.length || !req.body.folderId) return res.status(400).json({ error: 'Dodaj co najmniej jedną stronę i wybierz kartotekę.' });
      if (!await isDocumentFolder(prisma, req.body.folderId)) return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do podkartotek.' });
      const retentionValue = Number(req.body.retentionValue);
      const retentionUnit = String(req.body.retentionUnit || 'years');
      if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
        removeTemporaryFiles();
        return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
      }
      const pdf = await PDFDocument.create();
      for (const file of files) {
        const bytes = fs.readFileSync(file.path);
        const image = file.mimetype === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const filename = 'SCAN_DOCUMENT_' + Date.now() + '.pdf';
      fs.writeFileSync(path.join(uploadsDir, filename), await pdf.save());
      removeTemporaryFiles();
      res.status(201).json(await prisma.document.create({ data: {
        title: String(req.body.title).slice(0, 255), filePath: filename, folderId: Number(req.body.folderId), mimeType: 'application/pdf',
        retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
      } }));
    } catch (error: unknown) {
      removeTemporaryFiles();
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
    try {
      const retentionValue = Number(rawRetentionValue);
      if (!validDraftId(draftId) || !folderId || !title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(String(retentionUnit))) {
        return res.status(400).json({ error: 'Nieprawidłowe dane dokumentu.' });
      }
      if (!await isDocumentFolder(prisma, folderId)) return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do podkartotek.' });
      const draftDir = getDraftDir(draftId);
      if (!fs.existsSync(draftDir)) return res.status(400).json({ error: 'Nie znaleziono wersji roboczej na komputerze.' });
      const pagePaths = fs.readdirSync(draftDir).filter((name) => /^page-\d{3}\.jpg$/.test(name)).sort().map((name) => path.join(draftDir, name));
      if (!pagePaths.length) return res.status(400).json({ error: 'Wersja robocza nie zawiera stron.' });
      const pdf = await PDFDocument.create();
      for (const pagePath of pagePaths) {
        const image = await pdf.embedJpg(fs.readFileSync(pagePath));
        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      }
      const filename = 'SCAN_DOCUMENT_' + Date.now() + '.pdf';
      fs.writeFileSync(path.join(uploadsDir, filename), await pdf.save());
      const document = await prisma.document.create({ data: {
        title: String(title).slice(0, 255), filePath: filename, folderId: Number(folderId), mimeType: 'application/pdf',
        retentionEnabled: Boolean(retentionEnabled), retentionValue, retentionUnit: String(retentionUnit),
        thumbnail: typeof thumbnail === 'string' && /^data:image\/jpeg;base64,/.test(thumbnail) && thumbnail.length <= 300_000 ? thumbnail : null,
      } });
      fs.rmSync(draftDir, { recursive: true, force: true });
      res.status(201).json(document);
    } catch (error: unknown) {
      console.error('[/api/mobile-scan-draft/finalize] BŁĄD:', errorMessage(error));
      res.status(500).json({ error: 'Nie udało się scalić dokumentu do PDF.' });
    }
  });
  return router;
}
