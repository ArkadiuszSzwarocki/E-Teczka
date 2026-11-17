import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireLocalDesktop } from '../middleware/accessControl';
import { catalogEnabled, getCatalog, saveCatalog, quote, planIds } from '../services/planCatalog';
import { refreshPlanPolicy } from '../services/planPolicy';
import {centralCatalogAdminEnabled,readCentralCatalog,writeCentralCatalog} from '../services/centralCatalogAdmin';
import { getDevOverrides, setDevOverrides } from '../services/devOverrides';
export function createDeveloperCatalogRouter(prisma?: PrismaClient) {
 const router = express.Router(); router.use(requireLocalDesktop);
 router.use((req,res,next) => {
  if (!catalogEnabled()) return res.status(404).json({error:'Panel jest dostępny tylko w trybie deweloperskim.'});
  if (!/^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(req.header('origin') || '')) return res.status(403).json({error:'Otwórz panel w lokalnej aplikacji deweloperskiej.'});
  next();
 });
 router.get('/', async(_req,res) => {
  if (centralCatalogAdminEnabled()) {
    try { return res.json(await readCentralCatalog()); }
    catch (error) { console.warn('Nie udało się odczytać centralnych planów, użyto lokalnych:', error instanceof Error ? error.message : error); }
  }
  return res.json(getCatalog());
 });
 router.put('/', async(req,res) => { try { const data=centralCatalogAdminEnabled()?await writeCentralCatalog(req.body):saveCatalog(req.body); refreshPlanPolicy(); return res.json(data); } catch(error) { return res.status(400).json({error: error instanceof Error ? error.message : 'Nie udało się zapisać konfiguracji.'}); } });
 router.get('/preview', (req,res) => { const now = req.query.at ? new Date(String(req.query.at)) : new Date(); if (!Number.isFinite(now.getTime())) return res.status(400).json({error:'Nieprawidłowa data.'}); return res.json(Object.fromEntries(planIds.map(id => [id,{ monthly:quote(id,'monthly',now),yearly:quote(id,'yearly',now) }]))); });
 router.get('/overrides', (_req, res) => res.json(getDevOverrides()));
 router.put('/overrides', (req, res) => res.json(setDevOverrides({
  bypassDeviceLimit: typeof req.body?.bypassDeviceLimit === 'boolean' ? req.body.bypassDeviceLimit : undefined,
  bypassPlanLimits: typeof req.body?.bypassPlanLimits === 'boolean' ? req.body.bypassPlanLimits : undefined
 })));
 router.post('/clear-sessions', async (_req, res) => {
  if (!prisma) return res.status(503).json({ error: 'Brak połączenia z bazą sesji.' });
  const result = await prisma.authSession.deleteMany({});
  return res.json({ cleared: result.count });
 });
 return router;
}
