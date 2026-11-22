import express from 'express';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan } from '../services/planLedger';
import { getWatchFolderConfig, ingestWatchUploadBatch, saveWatchFolderConfig, scanWatchFolder } from '../services/watchFolderService';
import { createAccountantZipArchive } from '../services/accountantExport';

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
