import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { canAccessFolder } from '../services/familyAccess';
import { isDocumentFolder } from '../services/folders';
import { ocrOwnerKey } from '../services/ocrPremium';
import { checkDocumentCapacity, getPlan } from '../services/planLedger';
import { getWatchFolderConfig, ingestWatchUploadBatch, saveWatchFolderConfig, scanWatchFolder } from '../services/watchFolderService';
import { createAccountantZipArchive } from '../services/accountantExport';
import { parseEReceiptPayload } from '../services/eReceiptParser';
import { protectOcrText } from '../services/ocrText';

const PREMIUM_PLANS = new Set(['premium', 'family', 'business']);
const watchUpload = multer({ storage: multer.memoryStorage(), limits: { files: 30, fileSize: 25 * 1024 * 1024 } });

export function createAutomationRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ownerIdOf = (res: express.Response) => Number(res.locals.userId || 1);

  const requirePremium = async (res: express.Response): Promise<boolean> => {
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    if (!PREMIUM_PLANS.has(plan)) {
      res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Ta funkcja wymaga planu Premium, Rodzinny lub Firmowy.' });
      return false;
    }
    return true;
  };

  router.get('/watch-folder', async (_req, res) => {
    const plan = await getPlan(prisma, ocrOwnerKey(res));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...getWatchFolderConfig(ownerIdOf(res)), allowed: PREMIUM_PLANS.has(plan) });
  });

  router.put('/watch-folder', async (req, res) => {
    if (!await requirePremium(res)) return;
    try {
      const saved = saveWatchFolderConfig(ownerIdOf(res), {
        folderPath: String(req.body?.folderPath || ''),
        enabled: req.body?.enabled !== false,
      });
      res.json({ ...saved, allowed: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać gorącego folderu.' });
    }
  });

  router.post('/watch-folder/scan', async (_req, res) => {
    if (!await requirePremium(res)) return;
    try {
      const result = await scanWatchFolder(prisma, ownerIdOf(res));
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się przeskanować gorącego folderu.' });
    }
  });

  router.post('/watch-folder/upload', watchUpload.array('files', 30), async (req, res) => {
    if (!await requirePremium(res)) return;
    try {
      const uploaded = Array.isArray(req.files) ? req.files : [];
      if (!uploaded.length) {
        res.status(400).json({ error: 'Wybierz pliki PDF lub zdjęcia z folderu do przeskanowania.' });
        return;
      }
      const sourceLabel = typeof req.body?.folderName === 'string' ? req.body.folderName : 'Folder na telefonie';
      const result = await ingestWatchUploadBatch(
        prisma,
        ownerIdOf(res),
        sourceLabel,
        uploaded.map(f => ({ name: f.originalname, buffer: f.buffer })),
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się przetworzyć plików z folderu.' });
    }
  });

  router.post('/e-receipt/import', async (req, res) => {
    if (!await requirePremium(res)) return;
    try {
      const folderId = Number(req.body?.folderId);
      const rawPayload = typeof req.body?.payload === 'string' ? req.body.payload : JSON.stringify(req.body?.payload ?? '');
      if (!Number.isInteger(folderId) || folderId < 1) {
        res.status(400).json({ error: 'Wybierz docelową kartotekę dla e-Paragonu.' });
        return;
      }
      const owner = ownerIdOf(res);
      if (!await canAccessFolder(prisma, owner, folderId) || !await isDocumentFolder(prisma, folderId)) {
        res.status(403).json({ error: 'Brak dostępu do wybranej kartoteki.' });
        return;
      }
      const parsed = parseEReceiptPayload(rawPayload);
      if (!parsed) {
        res.status(400).json({ error: 'Nie rozpoznano prawidłowego e-Paragonu (QR / JSON).' });
        return;
      }
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      const fileName = `DOC_${Date.now()}_${randomUUID()}.json`;
      const fullPath = path.join(uploadsDir, fileName);
      const serialized = JSON.stringify({ rawPayload, parsed }, null, 2);
      fs.writeFileSync(fullPath, serialized, 'utf8');
      try {
        const title = typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim().slice(0, 255)
          : `e-Paragon ${parsed.merchantName} ${(parsed.amountCents / 100).toFixed(2)} ${parsed.currency}`;
        const created = await prisma.$transaction(async tx => {
          await checkDocumentCapacity(tx, owner, plan, 1);
          const doc = await tx.document.create({
            data: {
              title,
              filePath: fileName,
              mimeType: 'application/json',
              folderId,
              userId: owner,
              merchantName: parsed.merchantName,
              amountCents: parsed.amountCents,
              currency: parsed.currency,
              paymentStatus: 'paid',
              retentionEnabled: Boolean(parsed.suggestWarrantyYears),
              retentionValue: parsed.suggestWarrantyYears || 2,
              retentionUnit: 'years',
              ocrText: protectOcrText(parsed.summaryText),
            },
          });
          if (parsed.items.length > 0) {
            await tx.documentLineItem.createMany({
              data: parsed.items.map(item => ({
                documentId: doc.id,
                name: item.name,
                quantity: item.quantity,
                totalCents: item.totalCents,
                category: item.category,
              })),
            });
          }
          return doc;
        });
        res.status(201).json({ document: created, parsed });
      } catch (err) {
        fs.rmSync(fullPath, { force: true });
        throw err;
      }
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zaimportować e-Paragonu.' });
    }
  });

  router.post('/accountant-bundle', async (req, res) => {
    if (!await requirePremium(res)) return;
    try {
      const month = typeof req.body?.month === 'string' ? req.body.month : undefined;
      const { archive, label } = await createAccountantZipArchive(prisma, ownerIdOf(res), month);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="paczka-ksiegowa-${label}.zip"`);
      archive.pipe(res);
      await archive.finalize();
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się utworzyć paczki ZIP.' });
      }
    }
  });

  return router;
}
