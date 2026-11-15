"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeveloperCatalogRouter = createDeveloperCatalogRouter;
const express_1 = __importDefault(require("express"));
const accessControl_1 = require("../middleware/accessControl");
const planCatalog_1 = require("../services/planCatalog");
const planPolicy_1 = require("../services/planPolicy");
function createDeveloperCatalogRouter() {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((req, res, next) => {
        if (!(0, planCatalog_1.catalogEnabled)())
            return res.status(404).json({ error: 'Panel jest dostępny tylko w trybie deweloperskim.' });
        if (!/^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(req.header('origin') || ''))
            return res.status(403).json({ error: 'Otwórz panel w lokalnej aplikacji deweloperskiej.' });
        next();
    });
    router.get('/', (_req, res) => res.json((0, planCatalog_1.getCatalog)()));
    router.put('/', (req, res) => { try {
        const data = (0, planCatalog_1.saveCatalog)(req.body);
        (0, planPolicy_1.refreshPlanPolicy)();
        return res.json(data);
    }
    catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać konfiguracji.' });
    } });
    router.get('/preview', (req, res) => { const now = req.query.at ? new Date(String(req.query.at)) : new Date(); if (!Number.isFinite(now.getTime()))
        return res.status(400).json({ error: 'Nieprawidłowa data.' }); return res.json(Object.fromEntries(planCatalog_1.planIds.map(id => [id, { monthly: (0, planCatalog_1.quote)(id, 'monthly', now), yearly: (0, planCatalog_1.quote)(id, 'yearly', now) }]))); });
    return router;
}
