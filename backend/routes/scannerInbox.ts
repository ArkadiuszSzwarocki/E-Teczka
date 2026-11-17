import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { mergeDocuments } from '../services/mergeDocuments';
import { parseBase64DataUrl } from '../services/base64DataUrl';
import { isDocumentFolder } from '../services/folders';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan, ensurePlanLedger, consumeUsage, checkDocumentCapacity, PlanLimitError } from '../services/planLedger';
import { enqueuePremiumOcr } from '../services/ocrEnqueue';
import { assertUniqueDocument, DuplicateDocumentError, hashFile } from '../services/duplicateDocuments';
import { prepareScannedPdf } from '../services/scannedPdfArchive';
import type { createOcrQueue } from '../services/ocrQueue';

type ScanInfo = { id: string; title: string; createdAt: string; retentionEnabled: boolean; retentionValue: number; retentionUnit: string; pdfa?: boolean; pdfaWarning?: string };
const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
function uniqueTitle(title: string, existing: string[]): string {
  const used = new Set(existing.map(value => value.toLocaleLowerCase('pl-PL')));
  if (!used.has(title.toLocaleLowerCase('pl-PL'))) return title;
  const extension = path.extname(title);
  const base = title.slice(0, title.length - extension.length);
  let number = 2;
  while (used.has(`${base} (${number})${extension}`.toLocaleLowerCase('pl-PL'))) number++;
  return `${base} (${number})${extension}`;
}

export function createScannerInboxRouter(prisma: PrismaClient, ocrQueue?: ReturnType<typeof createOcrQueue>) {
  const router = express.Router();
  const moving = new Set<string>();
  const directory = (res: express.Response) => path.join(uploadsDir, '.scanner-inbox', String(Number(res.locals.userId || 1)));
  router.get('/', (_req, res) => {
    const dir = directory(res); fs.mkdirSync(dir, { recursive: true });
    const scans = fs.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
      try { const info = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ScanInfo; return validId(info.id) && fs.existsSync(path.join(dir, `${info.id}.pdf`)) ? [info] : []; } catch { return []; }
    });
    res.json(scans.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  });
  router.post('/', async (req, res) => {
    const { files, title, retention } = req.body || {};
    if (!Array.isArray(files) || !files.length || files.length > 20 || files.some((file: { data?: unknown }) => !parseBase64DataUrl(file?.data))) return res.status(400).json({ error: 'Nieprawidłowe strony skanu.' });
    if (typeof title !== 'string' || !title.trim() || title.length > 240 || !retention || typeof retention.enabled !== 'boolean' || !Number.isInteger(retention.value) || retention.value < 1 || !['years', 'months', 'days'].includes(retention.unit)) return res.status(400).json({ error: 'Sprawdź nazwę i termin życia dokumentu.' });
    try {
      const source = await mergeDocuments(files);
      const imageOnly = files.every((file: { data: string }) => { const parsed = parseBase64DataUrl(file.data); return parsed?.mimeType === 'image/jpeg' || parsed?.mimeType === 'image/png'; });
      const archive = imageOnly ? await prepareScannedPdf(source) : { bytes: Buffer.from(source), pdfa: false, warning: 'Plik zawiera inne materiały niż obrazy; zapisano zwykły PDF.' };
      const pdf = archive.bytes;
      const key = ocrOwnerKey(res); const plan = await getPlan(prisma, key); await ensurePlanLedger(prisma);
      const id = crypto.randomUUID(); const dir = directory(res); fs.mkdirSync(dir, { recursive: true });
      const requestedTitle = title.trim().toLowerCase().endsWith('.pdf') ? title.trim() : `${title.trim()}.pdf`;
      const existingTitles = fs.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
        try { const existing = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); return typeof existing.title === 'string' ? [existing.title] : []; } catch { return []; }
      });
      const info: ScanInfo = { id, title: uniqueTitle(requestedTitle, existingTitles), createdAt: new Date().toISOString(), retentionEnabled: retention.enabled, retentionValue: retention.value, retentionUnit: retention.unit, pdfa: archive.pdfa, pdfaWarning: archive.warning };
      await prisma.$transaction(async tx => { await consumeUsage(tx, key, plan, 'printerScan', id, files.length); if (files.length > 1) await consumeUsage(tx, key, plan, 'merge', id, 1); fs.writeFileSync(path.join(dir, `${id}.pdf`), pdf, { flag: 'wx' }); try { fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(info), { flag: 'wx' }); } catch (error) { fs.unlinkSync(path.join(dir, `${id}.pdf`)); throw error; } });
      res.status(201).json(info);
    } catch (error) { if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt }); res.status(500).json({ error: 'Nie udało się zapisać skanu w folderze tymczasowym.' }); }
  });
  router.patch('/:id', (req, res) => {
    const id = req.params.id; const ownerId = Number(res.locals.userId || 1);
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!validId(id) || !title || title.length > 240 || /[\r\n\x00-\x1f]/.test(title)) return res.status(400).json({ error: 'Podaj prawidłową nazwę dokumentu.' });
    const dir = directory(res); const file = path.join(dir, `${id}.json`);
    if (!fs.existsSync(file) || !fs.existsSync(path.join(dir, `${id}.pdf`))) return res.status(404).json({ error: 'Skan nie jest dostępny.' });
    if (moving.has(`${ownerId}:${id}`)) return res.status(409).json({ error: 'Skan jest w trakcie przenoszenia.' });
    let temp = '';
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8')) as ScanInfo;
      const names = fs.readdirSync(dir).filter(name => name.endsWith('.json') && name !== `${id}.json`).flatMap(name => {
        try { const item = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); return typeof item.title === 'string' ? [item.title] : []; } catch { return []; }
      });
      info.title = uniqueTitle(title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`, names);
      temp = path.join(dir, `${id}.${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(info), { flag: 'wx' }); fs.renameSync(temp, file);
      res.json(info);
    } catch { if (temp && fs.existsSync(temp)) fs.unlinkSync(temp); res.status(500).json({ error: 'Nie udało się zmienić nazwy skanu.' }); }
  });
  router.post('/:id/move', async (req, res) => {
    const id = req.params.id; const folderId = Number(req.body?.folderId); const ownerId = Number(res.locals.userId || 1);
    if (!validId(id)) return res.status(400).json({ error: 'Nieprawidłowy skan.' });
    const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId } });
    if (!folder || !await isDocumentFolder(prisma, folderId)) return res.status(400).json({ error: 'Wybierz własną kartotekę.' });
    const dir = directory(res); const metaPath = path.join(dir, `${id}.json`); const scanPath = path.join(dir, `${id}.pdf`);
    if (!fs.existsSync(metaPath) || !fs.existsSync(scanPath)) return res.status(404).json({ error: 'Skan nie jest dostępny.' });
    if (moving.has(`${ownerId}:${id}`) || moving.has(`folder:${folderId}`)) return res.status(409).json({ error: 'Trwa już przenoszenie do tej kartoteki. Spróbuj ponownie.' });
    moving.add(`${ownerId}:${id}`);
    moving.add(`folder:${folderId}`);
    try {
      const info = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ScanInfo;
      const existing = await prisma.document.findMany({ where: { folderId }, select: { title: true } });
      const finalTitle = uniqueTitle(info.title, existing.map(document => document.title));
      const filename = `${crypto.randomUUID()}.pdf`; const destination = path.join(uploadsDir, filename);
      fs.copyFileSync(scanPath, destination, fs.constants.COPYFILE_EXCL);
      let saved;
      try { const plan = await getPlan(prisma, ocrOwnerKey(res)); saved = await prisma.$transaction(async tx => { await assertUniqueDocument(tx, ownerId, folderId, await hashFile(scanPath)); await checkDocumentCapacity(tx, ownerId, plan, 1); return tx.document.create({ data: { title: finalTitle, filePath: filename, mimeType: 'application/pdf', folderId, userId: res.locals.userId || null, retentionEnabled: info.retentionEnabled, retentionValue: info.retentionValue, retentionUnit: info.retentionUnit } }); }); } catch (error) { fs.unlinkSync(destination); throw error; }
      void enqueuePremiumOcr(prisma, ocrQueue, res, saved.id);
      try { fs.unlinkSync(metaPath); fs.unlinkSync(scanPath); } catch (error) { console.error('[scanner] Nie udało się usunąć pliku tymczasowego:', error); }
      res.json(saved);
    } catch (error) { if (error instanceof DuplicateDocumentError) return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle }); if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message }); res.status(500).json({ error: 'Nie udało się przenieść skanu.' }); }
    finally { moving.delete(`${ownerId}:${id}`); moving.delete(`folder:${folderId}`); }
  });
  return router;
}
