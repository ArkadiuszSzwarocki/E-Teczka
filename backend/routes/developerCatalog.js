"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeveloperCatalogRouter = createDeveloperCatalogRouter;
const express_1 = __importDefault(require("express"));
const accessControl_1 = require("../middleware/accessControl");
const planCatalog_1 = require("../services/planCatalog");
const planPolicy_1 = require("../services/planPolicy");
const centralCatalogAdmin_1 = require("../services/centralCatalogAdmin");
const devOverrides_1 = require("../services/devOverrides");
function createDeveloperCatalogRouter(prisma) {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((req, res, next) => {
        if (!(0, planCatalog_1.catalogEnabled)())
            return res.status(404).json({ error: 'Panel jest dostępny tylko w trybie deweloperskim.' });
        if (!/^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(req.header('origin') || ''))
            return res.status(403).json({ error: 'Otwórz panel w lokalnej aplikacji deweloperskiej.' });
        next();
    });
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        if ((0, centralCatalogAdmin_1.centralCatalogAdminEnabled)()) {
            try {
                return res.json(yield (0, centralCatalogAdmin_1.readCentralCatalog)());
            }
            catch (error) {
                console.warn('Nie udało się odczytać centralnych planów, użyto lokalnych:', error instanceof Error ? error.message : error);
            }
        }
        return res.json((0, planCatalog_1.getCatalog)());
    }));
    router.put('/', (req, res) => __awaiter(this, void 0, void 0, function* () { try {
        const data = (0, centralCatalogAdmin_1.centralCatalogAdminEnabled)() ? yield (0, centralCatalogAdmin_1.writeCentralCatalog)(req.body) : (0, planCatalog_1.saveCatalog)(req.body);
        (0, planPolicy_1.refreshPlanPolicy)();
        return res.json(data);
    }
    catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać konfiguracji.' });
    } }));
    router.get('/preview', (req, res) => { const now = req.query.at ? new Date(String(req.query.at)) : new Date(); if (!Number.isFinite(now.getTime()))
        return res.status(400).json({ error: 'Nieprawidłowa data.' }); return res.json(Object.fromEntries(planCatalog_1.planIds.map(id => [id, { monthly: (0, planCatalog_1.quote)(id, 'monthly', now), yearly: (0, planCatalog_1.quote)(id, 'yearly', now) }]))); });
    router.get('/overrides', (_req, res) => res.json((0, devOverrides_1.getDevOverrides)()));
    router.put('/overrides', (req, res) => {
        var _a, _b;
        return res.json((0, devOverrides_1.setDevOverrides)({
            bypassDeviceLimit: typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.bypassDeviceLimit) === 'boolean' ? req.body.bypassDeviceLimit : undefined,
            bypassPlanLimits: typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.bypassPlanLimits) === 'boolean' ? req.body.bypassPlanLimits : undefined
        }));
    });
    router.post('/clear-sessions', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!prisma)
            return res.status(503).json({ error: 'Brak połączenia z bazą sesji.' });
        const result = yield prisma.authSession.deleteMany({});
        return res.json({ cleared: result.count });
    }));
    return router;
}
