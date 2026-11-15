import { getCatalog } from '../services/planCatalog';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { getPlan } from '../services/planLedger';

export function billingOwnerKey(response: express.Response) {
  return String(response.locals.billingOwnerKey || 'desktop-local');
}

function planKey(response: express.Response) { const key = billingOwnerKey(response); return key.startsWith('device:') && !response.locals.userId ? 'desktop-local' : key; }

export function requirePremium(prisma: PrismaClient) {
  return async (_request: express.Request, response: express.Response, next: express.NextFunction) => {
    const active = getCatalog().plans[await getPlan(prisma, planKey(response))].premiumTools;
    if (active) return next();
    return response.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Ta funkcja wymaga aktywnego planu Premium.' });
  };
}

export async function hasPremium(prisma: PrismaClient, response: express.Response) {
  return getCatalog().plans[await getPlan(prisma, planKey(response))].premiumTools;
}
