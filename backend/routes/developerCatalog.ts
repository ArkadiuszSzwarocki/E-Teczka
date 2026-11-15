import express from 'express';
import { requireLocalDesktop } from '../middleware/accessControl';
import { catalogEnabled, getCatalog, saveCatalog, quote, planIds } from '../services/planCatalog';
import { refreshPlanPolicy } from '../services/planPolicy';
export function createDeveloperCatalogRouter() {
 const router = express.Router(); router.use(requireLocalDesktop);
 router.use((req,res,next) => {
  if (!catalogEnabled()) return res.status(404).json({error:'Panel jest dostępny tylko w trybie deweloperskim.'});
  if (!/^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(req.header('origin') || '')) return res.status(403).json({error:'Otwórz panel w lokalnej aplikacji deweloperskiej.'});
  next();
 });
 router.get('/', (_req,res) => res.json(getCatalog()));
 router.put('/', (req,res) => { try { const data=saveCatalog(req.body); refreshPlanPolicy(); return res.json(data); } catch(error) { return res.status(400).json({error: error instanceof Error ? error.message : 'Nie udało się zapisać konfiguracji.'}); } });
 router.get('/preview', (req,res) => { const now = req.query.at ? new Date(String(req.query.at)) : new Date(); if (!Number.isFinite(now.getTime())) return res.status(400).json({error:'Nieprawidłowa data.'}); return res.json(Object.fromEntries(planIds.map(id => [id,{ monthly:quote(id,'monthly',now),yearly:quote(id,'yearly',now) }]))); });
 return router;
}
