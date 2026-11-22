import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { deleteKsefConfig, getPublicKsefConfig, saveKsefConfig, type KsefEnvironment } from '../services/ksefCredentialsStore';
import { syncKsefInvoices } from '../services/ksefSyncService';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getPlan } from '../services/planLedger';
import { errorMessage } from '../utils/errors';

export function createKsefRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ownerIdOf = (res: express.Response) => Number(res.locals.userId || 1);

  router.get('/config', (_req, res) => {
    res.json(getPublicKsefConfig(ownerIdOf(res)));
  });

  router.put('/config', async (req, res) => {
    try {
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      if (plan !== 'business') {
        return res.status(402).json({ code: 'BUSINESS_REQUIRED', error: 'Integracja z API KSeF wymaga planu Firmowego (JDG).' });
      }
      const ownerId = ownerIdOf(res);
      const rawFolderId = req.body?.targetFolderId;
      let targetFolderId: number | null = null;
      if (rawFolderId !== undefined && rawFolderId !== null && rawFolderId !== '') {
        const parsedId = Number(rawFolderId);
        const owned = await prisma.folder.findFirst({ where: { id: parsedId, ownerId }, select: { id: true } });
        if (!owned) return res.status(400).json({ error: 'Wybrana kartoteka docelowa nie istnieje.' });
        targetFolderId = owned.id;
      }
      const saved = saveKsefConfig(ownerId, {
        nip: String(req.body?.nip || ''),
        token: typeof req.body?.token === 'string' ? req.body.token : undefined,
        environment: (req.body?.environment as KsefEnvironment) || 'test',
        targetFolderId,
        schedule: req.body?.schedule === 'daily' ? 'daily' : 'manual',
      });
      res.json(saved);
    } catch (error) {
      res.status(400).json({ error: errorMessage(error, 'Nie udało się zapisać konfiguracji KSeF.') });
    }
  });

  router.delete('/config', (_req, res) => {
    deleteKsefConfig(ownerIdOf(res));
    res.json({ success: true });
  });

  router.post('/sync', async (req, res) => {
    try {
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      if (plan !== 'business') {
        return res.status(402).json({ code: 'BUSINESS_REQUIRED', error: 'Automatyczne pobieranie faktur z API KSeF wymaga planu Firmowego (JDG).' });
      }
      const daysBack = Number(req.body?.daysBack || 30);
      const result = await syncKsefInvoices(prisma, ownerIdOf(res), daysBack);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error, 'Nie udało się pobrać faktur z KSeF.') });
    }
  });

  return router;
}
