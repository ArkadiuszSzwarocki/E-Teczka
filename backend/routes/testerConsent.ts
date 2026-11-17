import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { getTesterConsent, saveTesterConsent, type TesterStorageMode } from '../services/testerConsent';

/** Endpoints for reading and recording public-test privacy & local storage consent. */
export function createTesterConsentRouter(prisma: PrismaClient) {
  const router = express.Router();
  const userId = (res: express.Response) => Number(res.locals.userId || 1);

  router.get('/', async (_req, res) => {
    try {
      res.json(await getTesterConsent(prisma, userId(res)));
    } catch {
      res.status(500).json({ error: 'Nie udało się sprawdzić zgody testera.' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const accepted = req.body?.accepted === true;
      const modeRaw = req.body?.storageMode;
      const storageMode: TesterStorageMode = modeRaw === 'qnap_server'
        ? 'qnap_server'
        : modeRaw === 'local_browser'
          ? 'local_browser'
          : 'local_disk';
      const record = await saveTesterConsent(prisma, userId(res), { accepted, storageMode });
      res.json({ consent: record });
    } catch {
      res.status(500).json({ error: 'Nie udało się zapisać zgody testera.' });
    }
  });

  return router;
}
