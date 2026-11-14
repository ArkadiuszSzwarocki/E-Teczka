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
        if (!(0, devPlans_1.devPlansEnabled)())
            return res.status(404).json({ error: 'Tryb testowania planów jest wyłączony.' });
        const origin = req.header('origin');
        if (!origin || !/^https?:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin))
            return res.status(403).json({ error: 'Przyciski są dostępne tylko w lokalnym interfejsie deweloperskim.' });
        next();
    });
    router.get('/', (_req, res) => { var _a; return res.json({ override: (_a = (0, devPlans_1.devPlan)((0, premium_1.billingOwnerKey)(res))) !== null && _a !== void 0 ? _a : null }); });
    router.put('/', (req, res) => {
        var _a;
        const value = (_a = req.body) === null || _a === void 0 ? void 0 : _a.plan;
        if (value !== null && value !== 'free' && value !== 'standard' && value !== 'premium')
            return res.status(400).json({ error: 'Nieznany plan testowy.' });
        (0, devPlans_1.setDevPlan)((0, premium_1.billingOwnerKey)(res), value);
        res.json({ override: value });
    });
    return router;
}
