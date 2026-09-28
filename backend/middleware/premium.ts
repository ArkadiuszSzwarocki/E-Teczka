import express from 'express';
import type { PrismaClient } from '@prisma/client';

export function billingOwnerKey(response: express.Response) {
  return String(response.locals.billingOwnerKey || 'desktop-local');
}

export function requirePremium(prisma: PrismaClient) {
  return async (_request: express.Request, response: express.Response, next: express.NextFunction) => {
    const subscription = await prisma.subscription.findUnique({ where: { ownerKey: billingOwnerKey(response) } });
    const active = subscription?.status === 'active' || subscription?.status === 'trialing';
    if (active) return next();
    return response.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Ta funkcja wymaga aktywnego planu Premium.' });
  };
}

export async function hasPremium(prisma: PrismaClient, response: express.Response) {
  const subscription = await prisma.subscription.findUnique({ where: { ownerKey: billingOwnerKey(response) } });
  return subscription?.status === 'active' || subscription?.status === 'trialing';
}
