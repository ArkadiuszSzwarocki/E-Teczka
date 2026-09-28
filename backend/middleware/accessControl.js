"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireLocalDesktop = requireLocalDesktop;
exports.requireAccess = requireAccess;
exports.registerPairingRoutes = registerPairingRoutes;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const paths_1 = require("../config/paths");
const authSecret_1 = require("../security/authSecret");
const AUTH_SECRET = (0, authSecret_1.authSecret)();
function loadPairedDevices() {
    try {
        return JSON.parse(fs_1.default.readFileSync(paths_1.pairedDevicesFile, 'utf8'));
    }
    catch (_a) {
        return [];
    }
}
let pairedDevices = loadPairedDevices();
let pairingCode = createPairingCode();
let pairingExpiresAt = Date.now() + 10 * 60 * 1000;
const pairingAttempts = new Map();
function savePairedDevices() {
    const temporaryFile = `${paths_1.pairedDevicesFile}.tmp`;
    fs_1.default.writeFileSync(temporaryFile, JSON.stringify(pairedDevices, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs_1.default.renameSync(temporaryFile, paths_1.pairedDevicesFile);
}
function createPairingCode() { return crypto_1.default.randomInt(10000000, 100000000).toString(); }
function rotatePairingCode() {
    pairingCode = createPairingCode();
    pairingExpiresAt = Date.now() + 10 * 60 * 1000;
    pairingAttempts.clear();
}
function isLoopback(request) {
    const address = request.socket.remoteAddress || '';
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function requireLocalDesktop(request, response, next) {
    if (isLoopback(request))
        return next();
    response.status(403).json({ error: 'Ta funkcja jest dostępna tylko z aplikacji desktopowej.' });
}
function requireAccess(request, response, next) {
    var _a;
    const token = (_a = request.header('authorization')) === null || _a === void 0 ? void 0 : _a.replace(/^Bearer\s+/i, '');
    if (token) {
        const account = verifyAccountToken(token);
        if (account) {
            response.locals.userId = account.userId;
            response.locals.billingOwnerKey = `user:${account.userId}`;
            return next();
        }
    }
    if (isLoopback(request)) {
        response.locals.billingOwnerKey = 'desktop-local';
        return next();
    }
    if (!token)
        return response.status(401).json({ error: 'Brak autoryzacji urządzenia.' });
    const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
    const device = pairedDevices.find(item => item.tokenHash === tokenHash);
    if (!device)
        return response.status(401).json({ error: 'Urządzenie nie jest sparowane.' });
    device.lastSeenAt = new Date().toISOString();
    savePairedDevices();
    response.locals.billingOwnerKey = `device:${device.id}`;
    next();
}
function verifyAccountToken(token) {
    if (!AUTH_SECRET)
        return null;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature)
        return null;
    const payload = Buffer.from(encoded, 'base64url').toString('utf8');
    const expected = crypto_1.default.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
        return null;
    const [rawUserId, rawExpiry] = payload.split('.');
    const userId = Number(rawUserId);
    const expiresAt = Number(rawExpiry);
    return Number.isInteger(userId) && userId > 0 && Number.isFinite(expiresAt) && expiresAt > Date.now() ? { userId } : null;
}
function registerPairingRoutes(app) {
    app.get('/api/pairing-code', requireLocalDesktop, (_req, res) => {
        if (Date.now() >= pairingExpiresAt)
            rotatePairingCode();
        res.json({ code: pairingCode, expiresAt: pairingExpiresAt });
    });
    app.get('/api/network-info', requireLocalDesktop, (_req, res) => {
        const addresses = Object.values(os_1.default.networkInterfaces()).flat()
            .filter((item) => item !== undefined && item.family === 'IPv4' && !item.internal)
            .map(item => item.address)
            .filter(address => { const [first = -1, second = -1] = address.split('.').map(Number); return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168); });
        res.json({ addresses, port: Number(process.env.PORT || 3000) });
    });
    app.post('/api/pair', (req, res) => {
        var _a, _b;
        const address = req.socket.remoteAddress || 'unknown';
        const attempts = pairingAttempts.get(address) || 0;
        if (attempts >= 5) {
            rotatePairingCode();
            return res.status(429).json({ error: 'Za dużo nieudanych prób. Na komputerze wyświetlono nowy kod.' });
        }
        if (Date.now() >= pairingExpiresAt || ((_a = req.body) === null || _a === void 0 ? void 0 : _a.pairingCode) !== pairingCode) {
            pairingAttempts.set(address, attempts + 1);
            return res.status(401).json({ error: 'Nieprawidłowy lub wygasły kod parowania.' });
        }
        const accessToken = crypto_1.default.randomBytes(32).toString('base64url');
        const now = new Date().toISOString();
        pairedDevices.push({ id: crypto_1.default.randomUUID(), name: String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.deviceName) || 'Telefon').slice(0, 64), tokenHash: crypto_1.default.createHash('sha256').update(accessToken).digest('hex'), createdAt: now, lastSeenAt: now });
        savePairedDevices();
        rotatePairingCode();
        res.status(201).json({ accessToken });
    });
}
