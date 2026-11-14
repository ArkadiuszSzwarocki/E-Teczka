import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import { billingOwnerKey } from '../middleware/premium';
import { featureTrial } from './planLedger';

/** Paired devices access the desktop-local owner's documents. */
export function ocrOwnerKey(res: express.Response): string {
  const key = billingOwnerKey(res);
  return key.startsWith('device:') && !res.locals.userId ? 'desktop-local' : key;
}
export async function hasOcrPremium(prisma: PrismaClient, res: express.Response, startTrial = false): Promise<boolean> {
  return (await featureTrial(prisma, ocrOwnerKey(res), 'ocr', startTrial)).allowed;
}
