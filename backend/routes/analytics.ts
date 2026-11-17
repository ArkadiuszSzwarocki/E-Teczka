import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { buildAnalyticsSummary } from '../services/analyticsSummary';
import { featureTrial } from '../services/planLedger';
import { ocrOwnerKey } from '../services/ocrPremium';

/** Provides aggregated financial, storage, security, and deadline analytics for the dashboard. */
export function createAnalyticsRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/summary', async (req, res) => {
    try {
      const ownerId = Number(res.locals.userId || 1);
      const month = typeof req.query.month === 'string' ? req.query.month : undefined;
      const ocrTrial = await featureTrial(prisma, ocrOwnerKey(res), 'ocr', false);
      const allowReceiptInvoiceReading = ocrTrial.allowed || ocrTrial.startedAt === null;
      res.json(await buildAnalyticsSummary(prisma, ownerId, month, {
        allowReceiptInvoiceReading,
        receiptReadingTrialEndsAt: ocrTrial.endsAt ? ocrTrial.endsAt.toISOString() : null,
      }));
    } catch (error) {
      console.error('[analytics] summary:', error);
      res.status(500).json({ error: 'Nie udało się wyliczyć podsumowania.' });
    }
  });
  return router;
}
