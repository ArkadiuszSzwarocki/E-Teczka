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
const express_1 = __importDefault(require("express"));
const node_crypto_1 = require("node:crypto");
const accessControl_1 = require("../middleware/accessControl");
const accountMfa_1 = require("../services/accountMfa");
const centralAccountLink_1 = require("../services/centralAccountLink");
function createAccountSecurityRouter(prisma) {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); if (!res.locals.userId)
        return res.status(401).json({ error: 'Zaloguj się na konto.' }); next(); });
    const owner = (res) => `login:user:${Number(res.locals.userId)}`;
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
    router.post('/mfa/start', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a; try {
        if (!(yield reauthenticate(Number(res.locals.userId), (_a = req.body) === null || _a === void 0 ? void 0 : _a.password)))
            return res.status(401).json({ error: 'Nieprawidłowe hasło konta.' });
        const { uri } = accountMfa_1.accountMfa.start(owner(res));
        return res.json({ uri });
    }
    catch (_b) {
        return res.status(400).json({ error: 'Nie udało się rozpocząć konfiguracji. Sprawdź połączenie lub stan Authenticatora.' });
    } }));
    router.post('/mfa/confirm', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a, _b; try {
        const codes = accountMfa_1.accountMfa.confirm(owner(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.code) || ''));
        const token = ((_b = req.header('authorization')) === null || _b === void 0 ? void 0 : _b.replace(/^Bearer\s+/i, '')) || '';
        yield prisma.authSession.deleteMany({ where: { userId: Number(res.locals.userId), tokenHash: { not: (0, node_crypto_1.createHash)('sha256').update(token).digest('hex') } } });
        return res.json({ enabled: true, codes });
    }
    catch (_c) {
        return res.status(400).json({ error: 'Nieprawidłowy kod, konfiguracja wygasła lub nie udało się zapisać ustawień.' });
    } }));
    router.post('/mfa/disable', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a, _b; try {
        if (!(yield reauthenticate(Number(res.locals.userId), (_a = req.body) === null || _a === void 0 ? void 0 : _a.password)))
            return res.status(401).json({ error: 'Nieprawidłowe hasło konta.' });
        if (!accountMfa_1.accountMfa.verify(owner(res), String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.code) || '').trim()))
            return res.status(401).json({ error: 'Nieprawidłowy lub użyty kod. Po kilku błędach odczekaj 5 minut.' });
        accountMfa_1.accountMfa.remove(owner(res));
        return res.json({ enabled: false });
    }
    catch (_c) {
        return res.status(503).json({ error: 'Nie udało się wyłączyć weryfikacji.' });
    } }));
    return router;
}
