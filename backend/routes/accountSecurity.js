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
exports.createAccountSecurityRouter = createAccountSecurityRouter;
const backupMfaStore_1 = require("../services/backupMfaStore");
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const accessControl_1 = require("../middleware/accessControl");
const accountMfa_1 = require("../services/accountMfa");
const centralAccountLink_1 = require("../services/centralAccountLink");
const centralHandoff_1 = require("../services/centralHandoff");
const accountErasure_1 = require("../services/accountErasure");
function createAccountSecurityRouter(prisma, googleHandoffs = (0, centralHandoff_1.createCentralHandoffs)()) {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); if (!res.locals.userId)
        return res.status(401).json({ error: 'Zaloguj się na konto.' }); next(); });
    const owner = (res) => `login:user:${Number(res.locals.userId)}`;
    const approvals = new Map();
    const sessionHash = (req) => (0, node_crypto_1.createHash)('sha256').update(req.header('authorization') || '').digest('hex');
    const bound = (req, res, handle) => { const item = approvals.get(handle); return item && item.expires > Date.now() && item.userId === Number(res.locals.userId) && item.session === sessionHash(req) ? item : null; };
    router.post('/mfa/reauth/start', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
        const action = (_a = req.body) === null || _a === void 0 ? void 0 : _a.action;
        if (!base || !['start', 'disable'].includes(action))
            return res.status(400).json({ error: 'Nieprawidłowa operacja.' });
        for (const [handle, item] of approvals)
            if (item.expires <= Date.now()) {
                approvals.delete(handle);
                googleHandoffs.finish(handle);
            }
        if (approvals.size >= 64)
            return res.status(429).json({ error: 'Zbyt wiele rozpoczętych potwierdzeń.' });
        try {
            const result = yield googleHandoffs.start(base);
            approvals.set(result.handle, { userId: Number(res.locals.userId), session: sessionHash(req), action, expires: result.expiresAt });
            const url = new URL(result.url);
            url.searchParams.set('login', 'google');
            url.searchParams.set('purpose', 'security');
            return res.json(Object.assign(Object.assign({}, result), { url: url.href }));
        }
        catch (_b) {
            return res.status(503).json({ error: 'Nie można rozpocząć potwierdzenia Google.' });
        }
    }));
    router.post('/mfa/reauth/poll', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const handle = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.handle) || '');
        if (!bound(req, res, handle))
            return res.status(403).json({ error: 'Potwierdzenie wygasło lub należy do innej sesji.' });
        try {
            const result = yield googleHandoffs.poll(handle);
            if (result.status === 'approved') {
                const base = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
                if (!base || (yield (0, centralAccountLink_1.createCentralAccountLinks)(prisma).find(base, result.user.id)) !== Number(res.locals.userId))
                    return res.status(403).json({ error: 'Wybierz konto Google przypisane do aktualnego konta E‑Teczki.' });
            }
            return res.json({ status: result.status });
        }
        catch (_b) {
            return res.status(400).json({ error: 'Potwierdzenie wygasło. Rozpocznij je ponownie.' });
        }
    }));
    function authorizeChange(req_1, res_1, action_1) {
        return __awaiter(this, arguments, void 0, function* (req, res, action, consume = true) {
            var _a, _b;
            const handle = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.googleHandle) === 'string' ? req.body.googleHandle : '';
            if (!handle)
                return reauthenticate(Number(res.locals.userId), (_b = req.body) === null || _b === void 0 ? void 0 : _b.password);
            const binding = bound(req, res, handle);
            if (!binding || binding.action !== action)
                return false;
            if (!consume) {
                const result = yield googleHandoffs.poll(handle);
                const base = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
                return result.status === 'approved' && Boolean(base) && (yield (0, centralAccountLink_1.createCentralAccountLinks)(prisma).find(base, result.user.id)) === Number(res.locals.userId);
            }
            approvals.delete(handle);
            try {
                const approved = yield googleHandoffs.take(handle);
                try {
                    return (yield (0, centralAccountLink_1.createCentralAccountLinks)(prisma).find(approved.origin, approved.user.id)) === Number(res.locals.userId);
                }
                finally {
                    yield fetch(`${approved.origin}/logout`, { method: 'POST', headers: { authorization: `Bearer ${approved.centralToken}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
                }
            }
            finally {
                googleHandoffs.finish(handle);
            }
        });
    }
    function reauthenticate(userId, password) {
        return __awaiter(this, void 0, void 0, function* () {
            const base = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
            if (!base || typeof password !== 'string' || password.length > 200)
                return false;
            const user = yield prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
            if (!user)
                return false;
            let token;
            try {
                const r = yield fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }), redirect: 'error', signal: AbortSignal.timeout(10000) });
                if (!r.ok)
                    return false;
                const data = yield r.json();
                token = data.token;
                if (!token)
                    return false;
                const remote = yield (0, centralAccountLink_1.verifyCentralSession)(base, token);
                return (yield (0, centralAccountLink_1.createCentralAccountLinks)(prisma).find(base, remote.id)) === userId;
            }
            finally {
                if (token)
                    yield fetch(`${base}/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
            }
        });
    }
    router.get('/mfa', (_req, res) => { try {
        return res.json({ enabled: accountMfa_1.accountMfa.enabled(owner(res)), scope: 'desktop' });
    }
    catch (_a) {
        return res.status(503).json({ error: 'Nie można odczytać zabezpieczeń.' });
    } });
    router.post('/mfa/start', (req, res) => __awaiter(this, void 0, void 0, function* () { try {
        if (!(yield authorizeChange(req, res, 'start')))
            return res.status(401).json({ error: 'Potwierdź tożsamość przez Google lub hasłem E‑Teczki.' });
        const { uri, expiresAt } = accountMfa_1.accountMfa.start(owner(res));
        return res.json({ uri, expiresAt });
    }
    catch (_a) {
        return res.status(400).json({ error: 'Nie udało się rozpocząć konfiguracji. Sprawdź połączenie lub stan Authenticatora.' });
    } }));
    router.post('/mfa/confirm', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a, _b; try {
        const codes = accountMfa_1.accountMfa.confirm(owner(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.code) || ''));
        const token = ((_b = req.header('authorization')) === null || _b === void 0 ? void 0 : _b.replace(/^Bearer\s+/i, '')) || '';
        let warning;
        try {
            yield prisma.authSession.deleteMany({ where: { userId: Number(res.locals.userId), tokenHash: { not: (0, node_crypto_1.createHash)('sha256').update(token).digest('hex') } } });
        }
        catch (_c) {
            warning = '2FA zostało włączone, ale nie udało się wylogować pozostałych sesji.';
        }
        return res.json({ enabled: true, codes, warning });
    }
    catch (error) {
        if (error instanceof backupMfaStore_1.MfaSetupError)
            return res.status(400).json({ code: error.code, error: error.message });
        return res.status(503).json({ code: 'MFA_SAVE_FAILED', error: 'Nie udało się odczytać lub zapisać ustawień 2FA na komputerze. To błąd zapisu, a nie odrzucenie kodu. Spróbuj ponownie.' });
    } }));
    router.post('/mfa/disable', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a, _b; try {
        if (!(yield authorizeChange(req, res, 'disable', false)))
            return res.status(401).json({ error: 'Potwierdź tożsamość przez Google lub hasłem E‑Teczki.' });
        if (!accountMfa_1.accountMfa.verify(owner(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.code) || '').trim()))
            return res.status(401).json({ code: 'MFA_INVALID_CODE', error: 'Kod jest nieprawidłowy, wygasł lub był już użyty. Wpisz aktualny kod Authenticatora. Potwierdzenie Google pozostaje ważne do końca tej operacji. Po kilku błędach odczekaj 5 minut.' });
        if (((_b = req.body) === null || _b === void 0 ? void 0 : _b.googleHandle) && !(yield authorizeChange(req, res, 'disable')))
            return res.status(401).json({ error: 'Potwierdzenie Google wygasło. Rozpocznij ponownie.' });
        accountMfa_1.accountMfa.remove(owner(res));
        return res.json({ enabled: false });
    }
    catch (_c) {
        return res.status(503).json({ error: 'Nie udało się wyłączyć weryfikacji.' });
    } }));
    router.post('/delete-account', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            if (String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.confirmation) || '').trim().toUpperCase() !== 'USUŃ') {
                return res.status(400).json({ error: 'Wpisz słowo USUŃ, aby potwierdzić trwałe skasowanie konta i wszystkich danych.' });
            }
            const result = yield (0, accountErasure_1.eraseLocalAccountCompletely)(prisma, Number(res.locals.userId), {
                deleteCentral: ((_b = req.body) === null || _b === void 0 ? void 0 : _b.deleteCentral) === true,
                centralPassword: typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.password) === 'string' ? req.body.password : undefined,
            });
            return res.json(Object.assign({ success: true }, result));
        }
        catch (error) {
            return res.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się usunąć konta.' });
        }
    }));
    return router;
}
