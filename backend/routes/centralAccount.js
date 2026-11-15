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
exports.createCentralAccountRouter = createCentralAccountRouter;
const express_1 = __importDefault(require("express"));
const centralAccountLink_1 = require("../services/centralAccountLink");
const auth_1 = require("./auth");
const centralHandoff_1 = require("../services/centralHandoff");
const backupPrimary_1 = require("../services/backupPrimary");
const planLedger_1 = require("../services/planLedger");
// Local-desktop access must be enforced by the caller before mounting this router.
function createCentralAccountRouter(prisma, verify = centralAccountLink_1.verifyCentralSession, handoffs = (0, centralHandoff_1.createCentralHandoffs)(), verifyDesktop = backupPrimary_1.verifyBackupPrimary) {
    const router = express_1.default.Router();
    const links = (0, centralAccountLink_1.createCentralAccountLinks)(prisma);
    let desktopFailures = 0;
    let desktopBlockedUntil = 0;
    const origin = () => (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
    const bearer = (req) => { var _a; return ((_a = req.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '')) || ''; };
    router.get('/status', (_req, res) => { const base = origin(); res.json({ configured: Boolean(base), origin: base }); });
    router.post('/handoff/start', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
        try {
            return res.json(yield handoffs.start(base));
        }
        catch (_a) {
            return res.status(503).json({ error: 'Nie udało się rozpocząć logowania.' });
        }
    }));
    router.post('/handoff/poll', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            return res.json(yield handoffs.poll(String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.handle) || '')));
        }
        catch (_b) {
            return res.status(400).json({ error: 'Logowanie wygasło lub nie udało się połączyć.' });
        }
    }));
    router.post('/handoff/finish', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const handle = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.handle) || ''), approved = yield handoffs.take(handle), localId = yield links.find(approved.origin, approved.user.id);
            if (!localId)
                return res.status(409).json({ code: 'LOCAL_LINK_REQUIRED', user: approved.user, error: 'Połącz konto z istniejącymi danymi albo utwórz konto na tym komputerze.' });
            const user = yield prisma.user.findUnique({ where: { id: localId }, select: { id: true, email: true, name: true } });
            if (!user)
                return res.status(409).json({ error: 'Nie znaleziono konta lokalnego.' });
            const session = yield (0, auth_1.createSession)(prisma, user.id, user.email, user.name, req.body);
            handoffs.finish(handle);
            return res.json(session);
        }
        catch (error) {
            if (error instanceof auth_1.DeviceLimitError)
                return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
            return res.status(401).json({ error: 'Nie udało się potwierdzić sesji.' });
        }
    }));
    router.post('/handoff/link', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const localId = yield links.localUserId(bearer(req));
        if (!localId)
            return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
        try {
            const handle = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.handle) || ''), approved = yield handoffs.take(handle);
            if ((yield links.localUserId(bearer(req))) !== localId)
                return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
            const existing = yield links.find(approved.origin, approved.user.id);
            if (existing !== null && existing !== localId)
                return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
            if (existing === null)
                yield links.link(approved.origin, approved.user.id, localId);
            handoffs.finish(handle);
            return res.status(204).end();
        }
        catch (_b) {
            return res.status(409).json({ error: 'Nie udało się połączyć kont. Sprawdź istniejące powiązania.' });
        }
    }));
    router.post('/handoff/link-desktop', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (desktopBlockedUntil > Date.now())
            return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie za 5 minut.' });
        const secret = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.secret) === 'string' ? req.body.secret : '';
        if (!(yield verifyDesktop(prisma, 'desktop-local', secret))) {
            desktopFailures++;
            if (desktopFailures >= 5) {
                desktopBlockedUntil = Date.now() + 300000;
                desktopFailures = 0;
            }
            return res.status(401).json({ error: 'Nieprawidłowy PIN lub hasło aplikacji.' });
        }
        desktopFailures = 0;
        try {
            const handle = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.handle) || ''), approved = yield handoffs.take(handle);
            const user = yield prisma.user.findUnique({ where: { id: 1 }, select: { id: true, email: true, name: true } });
            if (!user)
                return res.status(409).json({ error: 'Nie znaleziono konta lokalnego z danymi komputera.' });
            if ((yield (0, planLedger_1.getPlan)(prisma, 'desktop-local')) !== 'free')
                return res.status(409).json({ code: 'BILLING_MIGRATION_REQUIRED', error: 'Aktywny plan lokalny wymaga przeniesienia do konta centralnego. Dane i obecny plan pozostają dostępne.' });
            const existing = yield links.find(approved.origin, approved.user.id);
            if (existing !== null && existing !== user.id)
                return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
            yield (0, planLedger_1.copyDesktopPlanState)(prisma, `user:${user.id}`);
            if (existing === null)
                yield links.link(approved.origin, approved.user.id, user.id);
            const session = yield (0, auth_1.createSession)(prisma, user.id, user.email, user.name, req.body);
            handoffs.finish(handle);
            return res.json(session);
        }
        catch (error) {
            if (error instanceof auth_1.DeviceLimitError)
                return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
            return res.status(409).json({ error: 'Nie udało się połączyć danych z tym kontem.' });
        }
    }));
    router.post('/handoff/create-local', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const localPassword = (_a = req.body) === null || _a === void 0 ? void 0 : _a.localPassword;
            if (typeof localPassword !== 'string' || localPassword.length < 8 || localPassword.length > 200)
                return res.status(400).json({ error: 'Ustaw hasło lokalne zawierające co najmniej 8 znaków.' });
            const handle = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.handle) || ''), approved = yield handoffs.take(handle);
            if ((yield links.find(approved.origin, approved.user.id)) !== null)
                return res.status(409).json({ error: 'To konto jest już połączone. Zaloguj się ponownie.' });
            const email = approved.user.email.trim().toLowerCase();
            if (yield prisma.user.findUnique({ where: { email }, select: { id: true } }))
                return res.status(409).json({ code: 'LOCAL_ACCOUNT_EXISTS', error: 'Konto lokalne z tym adresem już istnieje. Zaloguj się na nie i połącz konta.' });
            const user = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const created = yield tx.user.create({ data: { email, name: approved.user.name, passwordHash: (0, auth_1.passwordHash)(localPassword) }, select: { id: true, email: true, name: true } });
                yield tx.$executeRaw `INSERT INTO CentralAccountLink(centralOrigin, centralId, localUserId, createdAt) VALUES (${approved.origin}, ${approved.user.id}, ${created.id}, ${new Date().toISOString()})`;
                return created;
            }));
            const session = yield (0, auth_1.createSession)(prisma, user.id, user.email, user.name, req.body);
            handoffs.finish(handle);
            return res.status(201).json(session);
        }
        catch (error) {
            if (error instanceof auth_1.DeviceLimitError)
                return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
            return res.status(409).json({ error: 'Nie udało się utworzyć konta lokalnego lub sesji.' });
        }
    }));
    router.post('/link', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
        const localId = yield links.localUserId(bearer(req));
        if (!localId)
            return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
        try {
            const remote = yield verify(base, (_a = req.body) === null || _a === void 0 ? void 0 : _a.centralToken);
            if ((yield links.localUserId(bearer(req))) !== localId)
                return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
            const existing = yield links.find(base, remote.id);
            if (existing === localId)
                return res.status(204).end();
            if (existing !== null)
                return res.status(409).json({ error: 'Konto centralne jest już połączone z innym kontem lokalnym.' });
            yield links.link(base, remote.id, localId);
            return res.status(204).end();
        }
        catch (_b) {
            return res.status(409).json({ error: 'Nie udało się połączyć kont. Sprawdź sesję i istniejące powiązania.' });
        }
    }));
    router.post('/login', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
        try {
            const remote = yield verify(base, (_a = req.body) === null || _a === void 0 ? void 0 : _a.centralToken);
            const localId = yield links.find(base, remote.id);
            if (!localId)
                return res.status(409).json({ code: 'LOCAL_LINK_REQUIRED', error: 'Najpierw połącz konto centralne z kontem na tym komputerze.' });
            const user = yield prisma.user.findUnique({ where: { id: localId }, select: { id: true, email: true, name: true } });
            if (!user)
                return res.status(409).json({ error: 'Nie znaleziono połączonego konta lokalnego.' });
            return res.json(yield (0, auth_1.createSession)(prisma, user.id, user.email, user.name, req.body));
        }
        catch (error) {
            if (error instanceof auth_1.DeviceLimitError)
                return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
            return res.status(401).json({ error: 'Nie udało się potwierdzić sesji konta centralnego.' });
        }
    }));
    router.post('/unlink', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
        const localId = yield links.localUserId(bearer(req));
        if (!localId)
            return res.status(401).json({ error: 'Najpierw zaloguj się na konto lokalne.' });
        try {
            const remote = yield verify(base, (_a = req.body) === null || _a === void 0 ? void 0 : _a.centralToken);
            if ((yield links.localUserId(bearer(req))) !== localId)
                return res.status(401).json({ error: 'Sesja lokalna wygasła.' });
            if (!(yield links.unlink(base, remote.id, localId)))
                return res.status(404).json({ error: 'Nie znaleziono powiązania kont.' });
            return res.status(204).end();
        }
        catch (_b) {
            return res.status(401).json({ error: 'Nie udało się potwierdzić sesji konta centralnego.' });
        }
    }));
    return router;
}
