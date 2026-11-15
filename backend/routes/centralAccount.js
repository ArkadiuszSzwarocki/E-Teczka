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
const accountMfa_1 = require("../services/accountMfa");
const node_crypto_1 = require("node:crypto");
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
    router.get('/status', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        const base = origin();
        let googleEnabled = false;
        if (base) {
            try {
                const response = yield fetch(`${base}/public-config`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
                if (response.ok) {
                    const config = yield response.json();
                    googleEnabled = typeof config.googleWebClientId === 'string' && Boolean(config.googleWebClientId.trim());
                }
            }
            catch ( /* Password login remains available without Google. */_a) { /* Password login remains available without Google. */ }
        }
        res.json({ configured: Boolean(base), origin: base, googleEnabled });
    }));
    router.post('/request-password-reset', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Usługa kont nie jest skonfigurowana.' });
        const email = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.email) === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ error: 'Podaj poprawny adres e-mail.' });
        try {
            const upstream = yield fetch(`${base}/request-password-reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }), redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (upstream.status === 429)
                return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie później.' });
            if (!upstream.ok)
                return res.status(503).json({ error: 'Usługa jest chwilowo niedostępna. Spróbuj ponownie.' });
            return res.status(202).json({ message: 'Jeśli ten adres należy do potwierdzonego konta z hasłem, wyślemy link do jego zmiany. Sprawdź również folder spam.' });
        }
        catch (_b) {
            return res.status(503).json({ error: 'Nie można połączyć się z usługą kont. Spróbuj ponownie.' });
        }
    }));
    router.post('/register', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Usługa kont nie jest skonfigurowana.' });
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length < 8 || password.length > 200)
            return res.status(400).json({ error: 'Podaj e-mail i hasło od 8 do 200 znaków.' });
        try {
            const upstream = yield fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
            const payload = yield upstream.json();
            return res.status(upstream.status).json(payload);
        }
        catch (_a) {
            return res.status(503).json({ error: 'Nie można połączyć się z usługą kont. Spróbuj ponownie.' });
        }
    }));
    router.post('/credentials', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const base = origin();
        if (!base)
            return res.status(503).json({ error: 'Konto centralne nie jest skonfigurowane.' });
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 200)
            return res.status(400).json({ error: 'Podaj e-mail i hasło.' });
        let token;
        try {
            const login = yield fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), redirect: 'error', signal: AbortSignal.timeout(15000) });
            if (!login.ok)
                return res.status(login.status === 429 ? 429 : login.status === 503 ? 503 : 401).json({ error: 'Nie udało się zalogować. Sprawdź dane, potwierdzenie e-maila lub spróbuj później.' });
            const session = yield login.json();
            token = session.token;
            if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
                throw new Error('INVALID_SESSION');
            const start = yield handoffs.start(base);
            const requestId = new URL(start.url).hash.slice(1);
            const approval = yield fetch(`${base}/handoff/approve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ requestId }), redirect: 'error', signal: AbortSignal.timeout(10000) });
            if (!approval.ok)
                throw new Error('APPROVAL_FAILED');
            const approved = yield handoffs.poll(start.handle);
            if (approved.status !== 'approved')
                throw new Error('APPROVAL_FAILED');
            return res.json(Object.assign(Object.assign({}, start), { user: approved.user }));
        }
        catch (_a) {
            return res.status(503).json({ error: 'Nie udało się połączyć z usługą kont. Spróbuj ponownie.' });
        }
        finally {
            if (token)
                yield fetch(`${base}/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
        }
    }));
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
        var _a, _b;
        try {
            const handle = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.handle) || ''), approved = yield handoffs.take(handle);
            let localId = yield links.find(approved.origin, approved.user.id);
            if (!localId && ((_b = req.body) === null || _b === void 0 ? void 0 : _b.createNew) === true) {
                const email = approved.user.email.trim().toLowerCase();
                if (yield prisma.user.findUnique({ where: { email }, select: { id: true } }))
                    return res.status(409).json({ code: 'LOCAL_ACCOUNT_EXISTS', error: 'Na komputerze istnieje osobne konto z tym adresem. Połącz je po potwierdzeniu dotychczasowego dostępu.' });
                const created = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                    const user = yield tx.user.create({ data: { email, name: approved.user.name, passwordHash: (0, auth_1.passwordHash)((0, node_crypto_1.randomBytes)(32).toString('hex')) }, select: { id: true } });
                    yield tx.$executeRaw `INSERT INTO CentralAccountLink(centralOrigin, centralId, localUserId, createdAt) VALUES (${approved.origin}, ${approved.user.id}, ${user.id}, ${new Date().toISOString()})`;
                    return user;
                }));
                localId = created.id;
            }
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
            if (error instanceof accountMfa_1.AccountMfaRequired)
                return res.status(401).json({ code: error.code, error: error.message });
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
            if (error instanceof accountMfa_1.AccountMfaRequired)
                return res.status(401).json({ code: error.code, error: error.message });
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
            if (error instanceof accountMfa_1.AccountMfaRequired)
                return res.status(401).json({ code: error.code, error: error.message });
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
            if (error instanceof accountMfa_1.AccountMfaRequired)
                return res.status(401).json({ code: error.code, error: error.message });
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
