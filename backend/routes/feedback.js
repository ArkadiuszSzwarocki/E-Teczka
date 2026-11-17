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
exports.createFeedbackRouter = createFeedbackRouter;
exports.createDeveloperFeedbackRouter = createDeveloperFeedbackRouter;
const express_1 = __importDefault(require("express"));
const accessControl_1 = require("../middleware/accessControl");
const planCatalog_1 = require("../services/planCatalog");
const centralFeedback_1 = require("../services/centralFeedback");
const ALLOWED_CATEGORIES = new Set(['bug', 'feedback', 'backup', 'other']);
const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'resolved', 'closed']);
/** Public desktop route for sending user feedback/bug reports with screenshots to QNAP. */
function createFeedbackRouter() {
    const router = express_1.default.Router();
    router.post('/', (req, res, next) => {
        if (process.env.ETECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') {
            next();
            return;
        }
        (0, accessControl_1.requireLocalDesktop)(req, res, next);
    }, (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const category = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.category) || 'bug');
        const title = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.title) === 'string' ? req.body.title.trim() : '';
        const description = typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.description) === 'string' ? req.body.description.trim() : '';
        if (!ALLOWED_CATEGORIES.has(category))
            return res.status(400).json({ error: 'Wybierz prawidłową kategorię zgłoszenia.' });
        if (title.length < 3 || title.length > 160)
            return res.status(400).json({ error: 'Temat musi mieć od 3 do 160 znaków.' });
        if (description.length < 5 || description.length > 5000)
            return res.status(400).json({ error: 'Opis musi mieć od 5 do 5000 znaków.' });
        try {
            const result = yield (0, centralFeedback_1.submitCentralFeedback)({
                category,
                title,
                description,
                contactEmail: typeof ((_d = req.body) === null || _d === void 0 ? void 0 : _d.contactEmail) === 'string' ? req.body.contactEmail.trim() : undefined,
                appVersion: typeof ((_e = req.body) === null || _e === void 0 ? void 0 : _e.appVersion) === 'string' ? req.body.appVersion : undefined,
                platform: typeof ((_f = req.body) === null || _f === void 0 ? void 0 : _f.platform) === 'string' ? req.body.platform : process.platform,
                activeView: typeof ((_g = req.body) === null || _g === void 0 ? void 0 : _g.activeView) === 'string' ? req.body.activeView : undefined,
                screenshotDataUrl: typeof ((_h = req.body) === null || _h === void 0 ? void 0 : _h.screenshotDataUrl) === 'string' ? req.body.screenshotDataUrl : undefined,
            });
            return res.status(201).json(result);
        }
        catch (error) {
            return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się wysłać zgłoszenia.' });
        }
    }));
    return router;
}
/** Developer-only route for viewing and managing feedback reports stored on QNAP. */
function createDeveloperFeedbackRouter() {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((req, res, next) => {
        if (!(0, planCatalog_1.catalogEnabled)())
            return res.status(404).json({ error: 'Panel jest dostępny tylko w trybie deweloperskim.' });
        if (!/^http:\/\/(127\.0\.0\.1|localhost):5173$/.test(req.header('origin') || '')) {
            return res.status(403).json({ error: 'Otwórz panel w lokalnej aplikacji deweloperskiej.' });
        }
        next();
    });
    router.get('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const status = typeof req.query.status === 'string' && ALLOWED_STATUSES.has(req.query.status)
            ? req.query.status
            : undefined;
        try {
            return res.json({ items: yield (0, centralFeedback_1.listCentralFeedback)(status) });
        }
        catch (error) {
            return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się pobrać zgłoszeń.' });
        }
    }));
    router.patch('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const id = Number(req.params.id);
        const status = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.status) || '');
        if (!Number.isSafeInteger(id) || id < 1 || !ALLOWED_STATUSES.has(status)) {
            return res.status(400).json({ error: 'Nieprawidłowy identyfikator lub status.' });
        }
        try {
            return res.json(yield (0, centralFeedback_1.updateCentralFeedbackStatus)(id, status));
        }
        catch (error) {
            return res.status(502).json({ error: error instanceof Error ? error.message : 'Nie udało się zmienić statusu.' });
        }
    }));
    return router;
}
