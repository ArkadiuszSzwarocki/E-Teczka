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
exports.hasCentralLink = hasCentralLink;
exports.verifyEntitlement = verifyEntitlement;
exports.registerCentralDevice = registerCentralDevice;
exports.centralDeviceRegistered = centralDeviceRegistered;
exports.centralDeviceUsers = centralDeviceUsers;
exports.isCentralUnavailable = isCentralUnavailable;
exports.centralOfflineLease = centralOfflineLease;
exports.centralPlanRequest = centralPlanRequest;
exports.revokeCentralDevice = revokeCentralDevice;
exports.verifyCentralPurchase = verifyCentralPurchase;
exports.centralEntitlement = centralEntitlement;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const centralAccountLink_1 = require("./centralAccountLink");
function hasCentralLink(db, localUserId) {
    return __awaiter(this, void 0, void 0, function* () { if (!db.$queryRawUnsafe)
        return false; const tables = yield db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='CentralAccountLink'"); if (!tables.length)
        return false; const rows = yield db.$queryRawUnsafe('SELECT centralId FROM CentralAccountLink WHERE localUserId = ?', localUserId); return rows.length > 0; });
}
const filename = () => node_path_1.default.join(process.cwd(), 'security', 'central-entitlements.enc');
function read() { try {
    const text = node_fs_1.default.readFileSync(filename(), 'utf8');
    return JSON.parse(require('./backupCrypto').decrypt(text));
}
catch (error) {
    if (error.code === 'ENOENT')
        return {};
    throw error;
} }
function write(data) { const file = filename(); node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true }); node_fs_1.default.writeFileSync(file + '.tmp', require('./backupCrypto').encrypt(JSON.stringify(data)), { mode: 0o600 }); node_fs_1.default.renameSync(file + '.tmp', file); }
function update(id, entry) { const data = read(); data[id] = entry; write(data); }
function verifyEntitlement(signed, entry, now = Date.now()) {
    if (typeof (signed === null || signed === void 0 ? void 0 : signed.payload) !== 'string' || signed.payload.length > 100000 || typeof signed.signature !== 'string' || signed.publicKey !== entry.publicKey)
        throw new Error('INVALID_ENTITLEMENT');
    const key = node_crypto_1.default.createPublicKey({ key: Buffer.from(signed.publicKey, 'base64'), type: 'spki', format: 'der' });
    if (key.asymmetricKeyType !== 'ed25519' || !node_crypto_1.default.verify(null, Buffer.from(signed.payload), key, Buffer.from(signed.signature, 'base64url')))
        throw new Error('INVALID_ENTITLEMENT');
    const lease = JSON.parse(Buffer.from(signed.payload, 'base64url').toString());
    if (lease.version !== 1 || lease.accountId !== entry.accountId || lease.deviceId !== entry.deviceId || lease.kind !== 'desktop' || !['free', 'standard', 'premium'].includes(lease.plan) || !Number.isSafeInteger(lease.issuedAt) || !Number.isSafeInteger(lease.expiresAt) || lease.issuedAt > now + 60000 || lease.expiresAt <= now || lease.expiresAt > lease.issuedAt + 86400000 || (lease.validUntil !== null && lease.expiresAt > lease.validUntil))
        throw new Error('EXPIRED_ENTITLEMENT');
    if (lease.catalog) {
        require('./planCatalog').applyCentralCatalog(lease.catalog);
        require('./planPolicy').refreshPlanPolicy();
    }
    return lease;
}
function post(origin, endpoint, credential, body) {
    return __awaiter(this, void 0, void 0, function* () { const response = yield fetch(`${origin}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(7000) }); const value = yield response.json(); return { response, value }; });
}
function registerCentralDevice(localUserId, origin, accountId, token) {
    return __awaiter(this, void 0, void 0, function* () {
        const safe = (0, centralAccountLink_1.centralAccountOrigin)(origin);
        if (!safe)
            throw new Error('INVALID_ORIGIN');
        let entry = read()[localUserId];
        if (!entry || entry.origin !== safe || entry.accountId !== accountId) {
            entry = { origin: safe, accountId, deviceId: node_crypto_1.default.randomUUID(), credential: node_crypto_1.default.randomBytes(32).toString('base64url') };
            update(localUserId, entry);
        }
        // The key is obtained independently through the configured HTTPS origin, not from untrusted lease data.
        const keyResponse = yield fetch(`${safe}/entitlements/public-key`, { redirect: 'error', signal: AbortSignal.timeout(7000) });
        if (!keyResponse.ok)
            throw new Error('CENTRAL_ENTITLEMENTS_UNAVAILABLE');
        const config = yield keyResponse.json();
        const { response, value } = yield post(safe, '/entitlements/register', token, { deviceId: entry.deviceId, credential: entry.credential, kind: 'desktop', name: 'E‑Teczka Desktop' });
        if (!response.ok)
            throw new Error(value.code === 'DEVICE_LIMIT_REACHED' ? 'CENTRAL_DEVICE_LIMIT' : 'CENTRAL_ENTITLEMENTS_UNAVAILABLE');
        entry.publicKey = config.publicKey;
        verifyEntitlement(value, entry);
        entry.lease = value;
        entry.checkedAt = Date.now();
        entry.blocked = false;
        update(localUserId, entry);
    });
}
const running = new Map();
function centralDeviceRegistered(localUserId) { return Boolean(read()[localUserId]); }
function centralDeviceUsers() { return Object.keys(read()).map(Number); }
function isCentralUnavailable(error) { const e = error; return ['CENTRAL_OFFLINE', 'LEDGER_UNAVAILABLE', 'CENTRAL_LEDGER_UNAVAILABLE'].includes((e === null || e === void 0 ? void 0 : e.code) || '') || ['TypeError', 'TimeoutError', 'AbortError'].includes((e === null || e === void 0 ? void 0 : e.name) || ''); }
const failedAt = new Map();
const snapshotFile = () => node_path_1.default.join(process.cwd(), 'security', 'central-plan-snapshots.enc');
function snapshots() { try {
    return JSON.parse(require('./backupCrypto').decrypt(node_fs_1.default.readFileSync(snapshotFile(), 'utf8')));
}
catch (error) {
    if (error.code === 'ENOENT')
        return {};
    throw error;
} }
function snapshot(userId, key, value) { const data = snapshots(); if (value !== undefined) {
    const entry = read()[userId];
    if (!data[userId] || data[userId].accountId !== (entry === null || entry === void 0 ? void 0 : entry.accountId) || data[userId].deviceId !== (entry === null || entry === void 0 ? void 0 : entry.deviceId))
        data[userId] = { time: 0, accountId: entry === null || entry === void 0 ? void 0 : entry.accountId, deviceId: entry === null || entry === void 0 ? void 0 : entry.deviceId, values: {} };
    data[userId].time = Math.max(data[userId].time, Date.now());
    data[userId].values[key] = value;
    const file = snapshotFile();
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    node_fs_1.default.writeFileSync(file + '.tmp', require('./backupCrypto').encrypt(JSON.stringify(data)), { mode: 0o600 });
    node_fs_1.default.renameSync(file + '.tmp', file);
} return data[userId]; }
function centralOfflineLease(localUserId) { const entry = read()[localUserId]; if (!entry || entry.blocked)
    throw new Error('CENTRAL_ACCOUNT_REQUIRED'); return verifyEntitlement(entry.lease, entry); }
function centralPlanRequest(localUserId_1, endpoint_1) {
    return __awaiter(this, arguments, void 0, function* (localUserId, endpoint, body = {}) {
        var _a, _b;
        const entry = read()[localUserId];
        if (!entry || entry.blocked)
            throw new Error('CENTRAL_ACCOUNT_REQUIRED');
        const cacheKey = endpoint === '/ledger/status' ? 'status' : endpoint === '/ledger/trial' ? `trial:${body.feature}` : null;
        try {
            if (Date.now() - (failedAt.get(localUserId) || 0) < 10000)
                throw Object.assign(new Error('Brak połączenia z serwerem kont.'), { code: 'CENTRAL_OFFLINE' });
            const { response, value } = yield post(entry.origin, endpoint, entry.credential, body);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403 && value.code === 'DEVICE_LIMIT_REACHED') {
                    entry.blocked = true;
                    entry.lease = undefined;
                    update(localUserId, entry);
                }
                if (value.code === 'PLAN_LIMIT_REACHED') {
                    const { PlanLimitError } = require('./planLedger');
                    throw new PlanLimitError(value.feature, Number(value.limit), value.resetsAt ? new Date(value.resetsAt) : undefined);
                }
                throw Object.assign(new Error(value.error || 'Serwer planów jest niedostępny.'), { code: value.code || 'CENTRAL_LEDGER_UNAVAILABLE' });
            }
            failedAt.delete(localUserId);
            if (cacheKey)
                snapshot(localUserId, cacheKey, value);
            return value;
        }
        catch (error) {
            if (!isCentralUnavailable(error))
                throw error;
            if (error.code !== 'CENTRAL_OFFLINE')
                failedAt.set(localUserId, Date.now());
            if (cacheKey) {
                const lease = centralOfflineLease(localUserId);
                const saved = snapshot(localUserId, cacheKey), value = saved === null || saved === void 0 ? void 0 : saved.values[cacheKey];
                if (value && saved.accountId === entry.accountId && saved.deviceId === entry.deviceId && Date.now() >= saved.time - 60000) {
                    const catalog = lease.catalog, settings = (_a = catalog === null || catalog === void 0 ? void 0 : catalog.plans) === null || _a === void 0 ? void 0 : _a[lease.plan];
                    if (endpoint === '/ledger/trial') {
                        const allowed = value.endsAt === null ? Boolean(settings === null || settings === void 0 ? void 0 : settings[body.feature]) : value.allowed && Date.now() < value.endsAt;
                        if (body.start && !allowed)
                            throw new Error('Połącz się z internetem, aby rozpocząć okres próbny.');
                        return Object.assign(Object.assign({}, value), { allowed, offline: true });
                    }
                    const allowance = Object.assign({}, value.allowance);
                    for (const feature of ['documents', 'tags']) {
                        const limit = (_b = settings === null || settings === void 0 ? void 0 : settings.limits) === null || _b === void 0 ? void 0 : _b[feature];
                        if (typeof limit === 'number')
                            allowance[feature] = allowance[feature] === null ? limit : Math.min(limit, allowance[feature]);
                    }
                    return Object.assign(Object.assign({}, value), { plan: lease.plan, catalog: catalog || value.catalog, allowance, offline: true });
                }
            }
            throw error;
        }
    });
}
function revokeCentralDevice(localUserId, centralToken) {
    return __awaiter(this, void 0, void 0, function* () { const data = read(), entry = data[localUserId]; if (!entry)
        return; const { response } = yield post(entry.origin, '/devices/revoke', centralToken, { deviceId: entry.deviceId }); if (!response.ok)
        throw new Error('DEVICE_REVOKE_FAILED'); delete data[localUserId]; write(data); });
}
function verifyCentralPurchase(localUserId, input) {
    return __awaiter(this, void 0, void 0, function* () { const entry = read()[localUserId]; if (!entry)
        throw new Error('CENTRAL_ACCOUNT_REQUIRED'); const { response, value } = yield post(entry.origin, '/billing/google-play/verify', entry.credential, input); if (!response.ok)
        throw new Error(value.code || 'PURCHASE_NOT_VERIFIED'); yield centralEntitlement(localUserId, true); return value; });
}
function centralEntitlement(localUserId_1) {
    return __awaiter(this, arguments, void 0, function* (localUserId, force = false) {
        let entry = read()[localUserId];
        if (!entry)
            return null;
        if (force || Date.now() - (entry.checkedAt || 0) > 300000) {
            let pending = running.get(localUserId);
            if (!pending) {
                pending = (() => __awaiter(this, void 0, void 0, function* () { try {
                    const { response, value } = yield post(entry.origin, '/entitlements/refresh', entry.credential, {});
                    if (response.ok) {
                        verifyEntitlement(value, entry);
                        entry.lease = value;
                        entry.blocked = false;
                    }
                    else if (response.status === 401 || response.status === 403) {
                        entry.lease = undefined;
                        entry.blocked = true;
                    }
                }
                catch ( /* A signed lease remains usable offline until its fixed expiry. */_a) { /* A signed lease remains usable offline until its fixed expiry. */ } entry.checkedAt = Date.now(); update(localUserId, entry); }))();
                running.set(localUserId, pending);
            }
            try {
                yield pending;
            }
            finally {
                running.delete(localUserId);
            }
            entry = read()[localUserId];
        }
        if (entry.blocked)
            return { plan: 'free', expiresAt: 0, validUntil: null, blocked: true };
        try {
            const lease = verifyEntitlement(entry.lease, entry);
            return { plan: lease.plan, expiresAt: lease.expiresAt, validUntil: lease.validUntil, blocked: false };
        }
        catch (_a) {
            return { plan: 'free', expiresAt: 0, validUntil: null, blocked: false };
        }
    });
}
