import express from 'express';
import { requireLocalDesktop, verifyAccountToken } from '../middleware/accessControl';
import { billingOwnerKey } from '../middleware/premium';
import { devPlansEnabled, devPlan, setDevPlan } from '../services/devPlans';
import type { Plan } from '../services/planPolicy';
export function createDevPlanRouter() {
  const router = express.Router();
  router.use(requireLocalDesktop);
  router.use((req, res, next) => {
    if (!devPlansEnabled()) return res.status(404).json({ error: 'Tryb testowania planów jest wyłączony.' });
    const origin = req.header('origin');
    const isPublicTest = process.env.ETECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
    const isAllowedOrigin = Boolean(origin && (/^https?:\/\/(localhost|127\.0\.0\.1):(5173|3000)$/.test(origin) || (isPublicTest && origin === 'https://e-teczkatest.arecki.pl')));
    if (!isAllowedOrigin && !(isPublicTest && !origin)) return res.status(403).json({ error: 'Przyciski są dostępne tylko w lokalnym interfejsie deweloperskim lub trybie testowym.' });
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (token) {
      const account = verifyAccountToken(token);
      if (account) {
        res.locals.userId = account.userId;
        res.locals.billingOwnerKey = `user:${account.userId}`;
      }
    }
    next();
  });
  router.get('/', (_req, res) => res.json({ override: devPlan(billingOwnerKey(res)) ?? null }));
  router.put('/', (req, res) => {
    const value: unknown = req.body?.plan;
    if (value !== null && value !== 'free' && value !== 'standard' && value !== 'premium' && value !== 'family' && value !== 'business') return res.status(400).json({ error: 'Nieznany plan testowy.' });
    setDevPlan(billingOwnerKey(res), value as Plan | null);
    res.json({ override: value });
  });
  return router;
}
