import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { createAccountantZipArchive } from '../services/accountantExport';
import { buildAnalyticsSummary } from '../services/analyticsSummary';
import { getProductPriceHistory } from '../services/priceInflationService';
import { detectRecurringBillsAndHikes } from '../services/recurringBillsService';
import { detectPotentialDuplicatePayments } from '../services/semanticDuplicateDetector';
import { featureTrial, getPlan } from '../services/planLedger';
import { ocrOwnerKey } from '../services/ocrPremium';

/** Provides aggregated financial, storage, security, and deadline analytics for the dashboard. */
export function createAnalyticsRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/summary', async (req, res) => {
    try {
      const ownerId = Number(res.locals.userId || 1);
      const month = typeof req.query.month === 'string' ? req.query.month : undefined;
      let allowReceiptInvoiceReading = true;
      let receiptReadingTrialEndsAt: string | null = null;
      try {
        const ocrTrial = await featureTrial(prisma, ocrOwnerKey(res), 'ocr', false);
        allowReceiptInvoiceReading = ocrTrial.allowed || ocrTrial.startedAt === null;
        receiptReadingTrialEndsAt = ocrTrial.endsAt ? ocrTrial.endsAt.toISOString() : null;
      } catch {
        allowReceiptInvoiceReading = true;
      }
      res.json(await buildAnalyticsSummary(prisma, ownerId, month, {
        allowReceiptInvoiceReading,
        receiptReadingTrialEndsAt,
      }));
    } catch (error) {
      console.error('[analytics] summary:', error);
      res.status(500).json({ error: 'Nie udało się wyliczyć podsumowania.' });
    }
  });
  router.get('/recurring-bills', async (_req, res) => {
    try {
      const ownerId = Number(res.locals.userId || 1);
      const [recurringBills, duplicateWarnings] = await Promise.all([
        detectRecurringBillsAndHikes(prisma, ownerId),
        detectPotentialDuplicatePayments(prisma, ownerId),
      ]);
      res.json({ recurringBills, duplicateWarnings });
    } catch (error) {
      console.error('[analytics] recurring-bills:', error);
      res.status(500).json({ error: 'Nie udało się przeanalizować stałych rachunków i duplikatów.' });
    }
  });

  router.get('/price-history', async (req, res) => {
    try {
      const ownerId = Number(res.locals.userId || 1);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      res.json(await getProductPriceHistory(prisma, ownerId, q));
    } catch (error) {
      console.error('[analytics] price-history:', error);
      res.status(500).json({ error: 'Nie udało się pobrać historii cen produktów.' });
    }
  });

  router.post('/accountant-share', async (req, res) => {
    try {
      const plan = await getPlan(prisma, ocrOwnerKey(res));
      if (plan !== 'business') {
        return res.status(402).json({ code: 'BUSINESS_REQUIRED', error: 'Portal dla księgowej wymaga planu Firmowego (JDG).' });
      }
      const base = process.env.MOJATECZKA_SHARE_SERVICE_URL;
      const secret = process.env.MOJATECZKA_SHARE_SERVICE_SECRET;
      if (!base || !secret || secret.length < 32) {
        return res.status(503).json({ error: 'Usługa bezpiecznych linków nie jest skonfigurowana (MOJATECZKA_SHARE_SERVICE_URL).' });
      }
      const origin = new URL(base).origin;
      const month = typeof req.body?.month === 'string' ? req.body.month : undefined;
      const { archive, label } = await createAccountantZipArchive(prisma, Number(res.locals.userId || 1), month);
      const pass = new PassThrough();
      const chunks: Buffer[] = [];
      pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
      const done = new Promise<void>((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
      archive.on('error', (err: Error) => pass.destroy(err));
      archive.pipe(pass);
      await archive.finalize();
      await done;
      const zipBuf = Buffer.concat(chunks);
      if (zipBuf.length > 50 * 1024 * 1024) {
        return res.status(413).json({ error: 'Paczka miesiąca przekracza 50 MB — pobierz ją lokalnie jako ZIP.' });
      }
      const pin = String(crypto.randomInt(100000, 1000000));
      const remote = await fetch(`${origin}/admin/shares`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: zipBuf.toString('base64'),
          mimeType: 'application/zip',
          expiresInSeconds: 7 * 24 * 3600,
          pin,
          singleUse: false,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const result = (await remote.json().catch(() => ({}))) as { url?: string; expiresAt?: string; error?: string };
      if (!remote.ok || !result.url) {
        return res.status(502).json({ error: result.error || 'Serwer linków odrzucił paczkę dla księgowej.' });
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({ url: result.url, pin, expiresAt: result.expiresAt, month: label });
    } catch (error) {
      console.error('[analytics] accountant-share:', error);
      res.status(500).json({ error: 'Nie udało się utworzyć linku dla księgowej.' });
    }
  });

  return router;
}
