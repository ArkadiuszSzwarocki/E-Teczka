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
exports.createAuthRouter = createAuthRouter;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importDefault(require("express"));
const authSecret_1 = require("../security/authSecret");
const AUTH_SECRET = (0, authSecret_1.authSecret)();
const SESSION_DAYS = 30;
const DEVICE_LIMITS = { free: 1, standard: 2, premium: Number.POSITIVE_INFINITY };
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
    const payload = `${userId}.${expiresAt.getTime()}`;
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
    router.get('/me', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const token = (_a = request.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '');
        if (!token)
            return response.status(401).json({ error: 'Brak aktywnej sesji.' });
        const session = yield prisma.authSession.findFirst({ where: { tokenHash: crypto_1.default.createHash('sha256').update(token).digest('hex'), expiresAt: { gt: new Date() } }, include: { user: true } });
        const user = session === null || session === void 0 ? void 0 : session.user;
        if (!user)
            return response.status(401).json({ error: 'Sesja wygasła.' });
        response.json({ id: user.id, email: user.email, name: user.name });
    }));
    return router;
}
class DeviceLimitError extends Error {
    constructor(limit) {
        super(`Limit urządzeń dla tego planu został osiągnięty (${limit}). Wyloguj inne urządzenie albo wybierz wyższy plan.`);
        this.limit = limit;
    }
}
function createSession(prisma, userId, email, name, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const deviceId = typeof (body === null || body === void 0 ? void 0 : body.deviceId) === 'string' && body.deviceId.trim().length >= 8 ? body.deviceId.trim().slice(0, 128) : crypto_1.default.randomUUID();
        const deviceName = typeof (body === null || body === void 0 ? void 0 : body.deviceName) === 'string' ? body.deviceName.trim().slice(0, 80) : 'Nieznane urządzenie';
        const subscription = yield prisma.subscription.findUnique({ where: { ownerKey: `user:${userId}` } });
        const plan = (subscription === null || subscription === void 0 ? void 0 : subscription.plan) === 'premium' && ['active', 'trialing'].includes(subscription.status) ? 'premium' : (subscription === null || subscription === void 0 ? void 0 : subscription.plan) === 'standard' && ['active', 'trialing'].includes(subscription.status) ? 'standard' : 'free';
        const limit = DEVICE_LIMITS[plan];
        if (Number.isFinite(limit)) {
            const activeSessions = yield prisma.authSession.findMany({ where: { userId, expiresAt: { gt: new Date() } }, select: { deviceId: true } });
            const deviceCount = new Set(activeSessions.map(session => session.deviceId).filter(Boolean)).size;
            const alreadyRegistered = activeSessions.some(session => session.deviceId === deviceId);
            if (!alreadyRegistered && deviceCount >= limit)
                throw new DeviceLimitError(limit);
        }
        const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
        const token = sessionToken(userId, expiresAt);
        yield prisma.authSession.create({ data: { tokenHash: crypto_1.default.createHash('sha256').update(token).digest('hex'), userId, expiresAt, deviceId, deviceName } });
        return { token, expiresAt, user: { id: userId, email, name } };
    });
}
