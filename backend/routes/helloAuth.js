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
exports.createHelloAuthRouter = createHelloAuthRouter;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const paths_1 = require("../config/paths");
const backupCrypto_1 = require("../services/backupCrypto");
const sessionPolicy_1 = require("../services/sessionPolicy");
const accessControl_1 = require("../middleware/accessControl");
const auth_1 = require("./auth");
const accountMfa_1 = require("../services/accountMfa");
function createHelloAuthRouter(prisma) {
    const router = express_1.default.Router();
    router.use(accessControl_1.requireLocalDesktop);
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    const filename = node_path_1.default.join(paths_1.securityDir, 'hello-credentials.enc');
    const pending = new Map();
    const read = () => { try {
        return JSON.parse((0, backupCrypto_1.decrypt)(node_fs_1.default.readFileSync(filename, 'utf8')));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return {};
        throw error;
    } };
    const save = (data) => { const temp = filename + '.tmp'; node_fs_1.default.writeFileSync(temp, (0, backupCrypto_1.encrypt)(JSON.stringify(data)), { mode: 0o600 }); node_fs_1.default.renameSync(temp, filename); };
    const authenticated = (req) => __awaiter(this, void 0, void 0, function* () { var _a; const token = ((_a = req.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '')) || ''; return prisma.authSession.findFirst({ where: Object.assign({ tokenHash: node_crypto_1.default.createHash('sha256').update(token).digest('hex') }, (0, sessionPolicy_1.activeSessionWhere)()), include: { user: true } }); });
    router.post('/enroll', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const session = yield authenticated(req);
            if (!(session === null || session === void 0 ? void 0 : session.user))
                return res.status(401).json({ error: 'Najpierw zaloguj się przez Google lub hasłem i 2FA.' });
            const publicKey = (_a = req.body) === null || _a === void 0 ? void 0 : _a.publicKey;
            if (typeof publicKey !== 'string' || publicKey.length > 1024)
                return res.sendStatus(400);
            const key = node_crypto_1.default.createPublicKey(publicKey);
            if (key.asymmetricKeyType !== 'ed25519')
                return res.sendStatus(400);
            const normalized = key.export({ type: 'spki', format: 'pem' }).toString();
            const keyId = node_crypto_1.default.createHash('sha256').update(normalized).digest('hex');
            const data = read();
            if (data[keyId] && data[keyId].userId !== session.user.id)
                return res.sendStatus(409);
            for (const [id, item] of Object.entries(data))
                if (item.userId === session.user.id && item.deviceId === req.body.deviceId)
                    delete data[id];
            const deviceId = typeof req.body.deviceId === 'string' && req.body.deviceId.length >= 8 ? req.body.deviceId.slice(0, 128) : `hello:${keyId.slice(0, 32)}`;
            data[keyId] = { userId: session.user.id, publicKey: normalized, deviceId };
            save(data);
            return res.json({ keyId, email: session.user.email, userId: session.user.id });
        }
        catch (_b) {
            return res.status(503).json({ error: 'Nie udało się zapisać zaufanego urządzenia.' });
        }
    }));
    router.post('/revoke', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a, _b; try {
        const session = yield authenticated(req);
        if (!(session === null || session === void 0 ? void 0 : session.user))
            return res.sendStatus(401);
        const data = read();
        const keyId = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.keyId) || '');
        if (((_b = data[keyId]) === null || _b === void 0 ? void 0 : _b.userId) === session.user.id) {
            delete data[keyId];
            save(data);
        }
        return res.sendStatus(204);
    }
    catch (_c) {
        return res.sendStatus(503);
    } }));
    router.post('/challenge', (req, res) => {
        var _a;
        try {
            for (const [id, item] of pending)
                if (item.expires <= Date.now())
                    pending.delete(id);
            if (pending.size >= 64)
                return res.sendStatus(429);
            const keyId = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.keyId) || '');
            if (!read()[keyId])
                return res.status(401).json({ error: 'Zaufanie urządzenia wygasło. Zaloguj się przez Google lub hasłem.' });
            const challenge = node_crypto_1.default.randomBytes(32).toString('base64url');
            pending.set(challenge, { keyId, expires: Date.now() + 90000, failures: 0, busy: false });
            return res.json({ challenge });
        }
        catch (_b) {
            return res.sendStatus(503);
        }
    });
    router.post('/login', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const challenge = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.challenge) || '');
        const item = pending.get(challenge);
        if (!item || item.expires <= Date.now() || item.busy)
            return res.status(401).json({ error: 'Potwierdzenie wygasło. Użyj Windows Hello ponownie.' });
        item.busy = true;
        try {
            const credential = read()[item.keyId];
            const signature = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.signature) === 'string' ? req.body.signature : '';
            if (!credential || signature.length > 200 || !node_crypto_1.default.verify(null, Buffer.from(`E-Teczka Hello login:${challenge}`), credential.publicKey, Buffer.from(signature, 'base64url'))) {
                pending.delete(challenge);
                return res.sendStatus(401);
            }
            const user = yield prisma.user.findUnique({ where: { id: credential.userId }, select: { id: true, email: true, name: true } });
            if (!user) {
                pending.delete(challenge);
                return res.sendStatus(401);
            }
            const session = yield (0, auth_1.createSession)(prisma, user.id, user.email, user.name, { mfaCode: (_c = req.body) === null || _c === void 0 ? void 0 : _c.mfaCode, deviceId: credential.deviceId, deviceName: 'E‑Teczka Desktop (Windows Hello)' }, 'trusted-hello');
            pending.delete(challenge);
            return res.json(session);
        }
        catch (error) {
            if (error instanceof accountMfa_1.AccountMfaRequired) {
                item.failures++;
                if (item.failures >= 5)
                    pending.delete(challenge);
                return res.status(401).json({ code: error.code, error: error.message });
            }
            pending.delete(challenge);
            if (error instanceof Error && error.message === 'CENTRAL_REGISTRATION_REQUIRED')
                return res.status(409).json({ error: 'Po aktualizacji zaloguj się raz przez Google lub hasłem E‑Teczki, aby potwierdzić plan i zaufanie komputera.' });
            if (error instanceof auth_1.DeviceLimitError)
                return res.status(403).json({ code: 'DEVICE_LIMIT_REACHED', error: error.message });
            return res.status(503).json({ error: 'Nie udało się zalogować przez Windows Hello.' });
        }
        finally {
            item.busy = false;
        }
    }));
    return router;
}
