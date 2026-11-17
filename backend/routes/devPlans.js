"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDevPlanRouter = createDevPlanRouter;
const express_1 = __importDefault(require("express"));
const accessControl_1 = require("../middleware/accessControl");
const premium_1 = require("../middleware/premium");
const devPlans_1 = require("../services/devPlans");
function createDevPlanRouter() {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((req, res, next) => {
        var _a;
        if (!(0, devPlans_1.devPlansEnabled)())
            return res.status(404).json({ error: 'Tryb testowania planów jest wyłączony.' });
        const origin = req.header('origin');
        const isPublicTest = process.env.ETECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
        const isAllowedOrigin = Boolean(origin && (/^https?:\/\/(localhost|127\.0\.0\.1):(5173|3000)$/.test(origin) || (isPublicTest && origin === 'https://e-teczkatest.arecki.pl')));
        if (!isAllowedOrigin && !(isPublicTest && !origin))
            return res.status(403).json({ error: 'Przyciski są dostępne tylko w lokalnym interfejsie deweloperskim lub trybie testowym.' });
        const token = (_a = req.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '');
        if (token) {
            const account = (0, accessControl_1.verifyAccountToken)(token);
            if (account) {
                res.locals.userId = account.userId;
                res.locals.billingOwnerKey = `user:${account.userId}`;
            }
        }
        next();
    });
    router.get('/', (_req, res) => { var _a; return res.json({ override: (_a = (0, devPlans_1.devPlan)((0, premium_1.billingOwnerKey)(res))) !== null && _a !== void 0 ? _a : null }); });
    router.put('/', (req, res) => {
        var _a;
        const value = (_a = req.body) === null || _a === void 0 ? void 0 : _a.plan;
        if (value !== null && value !== 'free' && value !== 'standard' && value !== 'premium' && value !== 'family' && value !== 'business')
            return res.status(400).json({ error: 'Nieznany plan testowy.' });
        (0, devPlans_1.setDevPlan)((0, premium_1.billingOwnerKey)(res), value);
        res.json({ override: value });
    });
    return router;
}
