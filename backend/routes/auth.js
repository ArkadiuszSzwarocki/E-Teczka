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
exports.DeviceLimitError = void 0;
exports.passwordHash = passwordHash;
exports.createAuthRouter = createAuthRouter;
exports.createSession = createSession;
const accountMfa_1 = require("../services/accountMfa");
const sessionPolicy_1 = require("../services/sessionPolicy");
const planCatalog_1 = require("../services/planCatalog");
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importDefault(require("express"));
const authSecret_1 = require("../security/authSecret");
const centralEntitlements_1 = require("../services/centralEntitlements");
const devOverrides_1 = require("../services/devOverrides");
const AUTH_SECRET = (0, authSecret_1.authSecret)();
function passwordHash(password, salt = crypto_1.default.randomBytes(16).toString('hex')) {
    const digest = crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${digest}`;
}
function passwordMatches(password, stored) {
    if (!stored)
        return false;
    const [salt, expected] = stored.split(':');
    if (!salt || !expected)
        return false;
    const actual = crypto_1.default.scryptSync(password, salt, 64).toString('hex');
    return expected.length === actual.length && crypto_1.default.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
function sessionToken(userId, expiresAt) {
    const payload = `${userId}.${expiresAt.getTime()}.${crypto_1.default.randomBytes(16).toString('hex')}`;
    const signature = crypto_1.default.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
    return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}
function validCredentials(body) {
    if (!body || typeof body !== 'object')
        return false;
    const value = body;
    return typeof value.email === 'string' && value.email.trim().length >= 5 && value.email.length <= 255
        && typeof value.password === 'string' && value.password.length >= 8 && value.password.length <= 200;
}
function createAuthRouter(prisma) {
    const router = express_1.default.Router();
    const ready = (0, sessionPolicy_1.ensureIdleSessionPolicy)(prisma);
    router.use((_req, res, next) => __awaiter(this, void 0, void 0, function* () { try {
        yield ready;
        next();
    }
    catch (_a) {
        return res.status(503).json({ error: 'Nie udało się przygotować sesji.' });
    } }));
    router.post('/register', (request, response) => __awaiter(this, void 0, void 0, function* () {
        if (!validCredentials(request.body))
            return response.status(400).json({ error: 'Podaj poprawny e‑mail i hasło (minimum 8 znaków).' });
        const email = request.body.email.trim().toLowerCase();
        try {
            const existing = yield prisma.user.findUnique({ where: { email } });
            if (existing)
                return response.status(409).json({ error: 'Konto z tym adresem już istnieje.' });
            const user = yield prisma.user.create({ data: { email, name: email.split('@')[0], passwordHash: passwordHash(request.body.password) } });
            return response.status(201).json(yield createSession(prisma, user.id, user.email, user.name, request.body));
        }
        catch (_a) {
            return response.status(500).json({ error: 'Nie udało się utworzyć konta.' });
        }
    }));
    router.post('/login', (request, response) => __awaiter(this, void 0, void 0, function* () {
        if (!validCredentials(request.body))
            return response.status(400).json({ error: 'Podaj e‑mail i hasło.' });
        const email = request.body.email.trim().toLowerCase();
        const user = yield prisma.user.findUnique({ where: { email } });
        if (!user || !passwordMatches(request.body.password, user.passwordHash))
            return response.status(401).json({ error: 'Nieprawidłowy e‑mail lub hasło.' });
        try {
            return response.json(yield createSession(prisma, user.id, user.email, user.name, request.body));
        }
        catch (error) {
            if (error instanceof accountMfa_1.AccountMfaRequired)
                return response.status(401).json({ code: error.code, error: error.message });
            if (error instanceof DeviceLimitError)
                return response.status(403).json({ error: error.message, code: 'DEVICE_LIMIT_REACHED', limit: error.limit });
            return response.status(500).json({ error: 'Nie udało się utworzyć sesji.' });
        }
    }));
    router.post('/logout', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const token = (_a = request.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '');
        if (token)
            yield prisma.authSession.deleteMany({ where: { tokenHash: crypto_1.default.createHash('sha256').update(token).digest('hex') } });
        response.json({ success: true });
    }));
    router.post('/activity', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const token = (_a = request.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '');
        if (!token)
            return response.status(401).json({ error: 'Brak aktywnej sesji.' });
        const now = new Date(), expiresAt = new Date(now.getTime() + sessionPolicy_1.SESSION_DURATION_MS);
        const result = yield prisma.authSession.updateMany({ where: Object.assign({ tokenHash: crypto_1.default.createHash('sha256').update(token).digest('hex') }, (0, sessionPolicy_1.activeSessionWhere)(now)), data: { expiresAt } });
        if (!result.count)
            return response.status(401).json({ error: 'Sesja wygasła. Zaloguj się ponownie.' });
        return response.json({ expiresAt, serverNow: now, idleTimeoutMs: sessionPolicy_1.SESSION_DURATION_MS });
    }));
    router.get('/me', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const token = (_a = request.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '');
        if (!token)
            return response.status(401).json({ error: 'Brak aktywnej sesji.' });
        const session = yield prisma.authSession.findFirst({ where: Object.assign({ tokenHash: crypto_1.default.createHash('sha256').update(token).digest('hex') }, (0, sessionPolicy_1.activeSessionWhere)()), include: { user: true } });
        const user = session === null || session === void 0 ? void 0 : session.user;
        if (!user)
            return response.status(401).json({ error: 'Sesja wygasła.' });
        response.json({ id: user.id, email: user.email, name: user.name, expiresAt: (0, sessionPolicy_1.effectiveSessionExpiry)(session.createdAt, session.expiresAt), serverNow: new Date(), idleTimeoutMs: sessionPolicy_1.SESSION_DURATION_MS });
    }));
    return router;
}
class DeviceLimitError extends Error {
    constructor(limit) {
        super(`Limit urządzeń dla tego planu został osiągnięty (${limit}). Wyloguj inne urządzenie albo wybierz wyższy plan.`);
        this.limit = limit;
    }
}
exports.DeviceLimitError = DeviceLimitError;
function createSession(prisma_1, userId_1, email_1, name_1, body_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, userId, email, name, body, authentication = 'standard') {
        var _a;
        // This mode is supplied internally only after verification of a registered device signature.
        if (authentication !== 'trusted-hello')
            (0, accountMfa_1.verifyAccountMfa)(userId, body === null || body === void 0 ? void 0 : body.mfaCode);
        const overrides = (0, devOverrides_1.getDevOverrides)();
        const central = yield (0, centralEntitlements_1.centralEntitlement)(userId, true);
        if ((central === null || central === void 0 ? void 0 : central.blocked) && !overrides.bypassDeviceLimit)
            throw new DeviceLimitError(0);
        if (!central && (yield (0, centralEntitlements_1.hasCentralLink)(prisma, userId)))
            throw new Error('CENTRAL_REGISTRATION_REQUIRED');
        const deviceId = typeof (body === null || body === void 0 ? void 0 : body.deviceId) === 'string' && body.deviceId.trim().length >= 8 ? body.deviceId.trim().slice(0, 128) : crypto_1.default.randomUUID();
        const deviceName = typeof (body === null || body === void 0 ? void 0 : body.deviceName) === 'string' ? body.deviceName.trim().slice(0, 80) : 'Nieznane urządzenie';
        const subscription = yield prisma.subscription.findUnique({ where: { ownerKey: `user:${userId}` } });
        const plan = central ? central.plan : (subscription === null || subscription === void 0 ? void 0 : subscription.plan) === 'premium' && ['active', 'trialing'].includes(subscription.status) ? 'premium' : (subscription === null || subscription === void 0 ? void 0 : subscription.plan) === 'standard' && ['active', 'trialing'].includes(subscription.status) ? 'standard' : 'free';
        const limit = (_a = (0, planCatalog_1.getCatalog)().plans[plan].accountDevices) !== null && _a !== void 0 ? _a : Number.POSITIVE_INFINITY;
        if (Number.isFinite(limit) && !overrides.bypassDeviceLimit) {
            const activeSessions = yield prisma.authSession.findMany({ where: Object.assign({ userId }, (0, sessionPolicy_1.activeSessionWhere)()), select: { deviceId: true } });
            const deviceCount = new Set(activeSessions.map(session => session.deviceId).filter(Boolean)).size;
            const alreadyRegistered = activeSessions.some(session => session.deviceId === deviceId);
            if (!alreadyRegistered && deviceCount >= limit)
                throw new DeviceLimitError(limit);
        }
        const expiresAt = new Date(Date.now() + sessionPolicy_1.SESSION_DURATION_MS);
        const token = sessionToken(userId, expiresAt);
        yield prisma.authSession.create({ data: { tokenHash: crypto_1.default.createHash('sha256').update(token).digest('hex'), userId, expiresAt, deviceId, deviceName } });
        return { token, expiresAt, user: { id: userId, email, name } };
    });
}
