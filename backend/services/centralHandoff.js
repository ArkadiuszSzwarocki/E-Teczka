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
exports.CentralHandoffError = void 0;
exports.createCentralHandoffs = createCentralHandoffs;
const node_crypto_1 = __importDefault(require("node:crypto"));
const centralAccountLink_1 = require("./centralAccountLink");
class CentralHandoffError extends Error {
    constructor(code, retryAfter) {
        super(code);
        this.code = code;
        this.retryAfter = retryAfter;
    }
}
exports.CentralHandoffError = CentralHandoffError;
function createCentralHandoffs(request = fetch) {
    const pending = new Map();
    const clearExpired = () => { const now = Date.now(); for (const [key, item] of pending)
        if (item.expiresAt <= now && !item.busy)
            pending.delete(key); };
    function post(origin, path, data) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(10000) });
            if (response.status === 429) {
                const retry = Number(response.headers.get('retry-after'));
                throw new CentralHandoffError('CENTRAL_RATE_LIMIT', Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 60);
            }
            if (response.status >= 500)
                throw new CentralHandoffError('CENTRAL_UNAVAILABLE');
            const result = yield response.json().catch(() => ({}));
            return { response, result };
        });
    }
    return {
        start(configuredOrigin) {
            return __awaiter(this, void 0, void 0, function* () {
                const origin = (0, centralAccountLink_1.centralAccountOrigin)(configuredOrigin);
                if (!origin)
                    throw new Error('INVALID_ORIGIN');
                clearExpired();
                if (pending.size >= 64)
                    throw new Error('TOO_MANY_REQUESTS');
                const verifier = node_crypto_1.default.randomBytes(32).toString('base64url');
                const challenge = node_crypto_1.default.createHash('sha256').update(verifier).digest('base64url');
                let started;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        started = yield post(origin, '/handoff/start', { challenge, deviceName: 'E-Teczka na komputerze' });
                        break;
                    }
                    catch (error) {
                        const e = error;
                        const transient = e instanceof CentralHandoffError ? e.code === 'CENTRAL_UNAVAILABLE' : e.name === 'TypeError';
                        if (attempt === 0 && transient) {
                            yield new Promise(resolve => setTimeout(resolve, 200));
                            continue;
                        }
                        if (e instanceof CentralHandoffError)
                            throw e;
                        throw new CentralHandoffError(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'CENTRAL_TIMEOUT' : 'CENTRAL_CONNECTION_FAILED');
                    }
                }
                if (!started)
                    throw new CentralHandoffError('CENTRAL_UNAVAILABLE');
                const { response, result } = started;
                if (!response.ok || typeof result.requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.requestId) || typeof result.displayCode !== 'string' || !/^\d{6}$/.test(result.displayCode) || typeof result.expiresAt !== 'number' || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 310000)
                    throw new Error('INVALID_RESPONSE');
                const handle = node_crypto_1.default.randomBytes(32).toString('base64url');
                pending.set(handle, { origin, requestId: result.requestId, verifier, expiresAt: result.expiresAt, busy: false });
                return { handle, displayCode: result.displayCode, expiresAt: result.expiresAt, url: `${origin}/account#${result.requestId}` };
            });
        },
        poll(handle) {
            return __awaiter(this, void 0, void 0, function* () {
                clearExpired();
                const item = pending.get(handle);
                if (!item || item.expiresAt <= Date.now())
                    throw new Error('EXPIRED');
                if (item.user && item.centralToken)
                    return { status: 'approved', user: item.user };
                if (item.busy)
                    return { status: 'pending' };
                item.busy = true;
                try {
                    if (!item.centralToken) {
                        const { response, result } = yield post(item.origin, '/handoff/claim', { requestId: item.requestId, verifier: item.verifier });
                        if (response.status === 202)
                            return { status: 'pending' };
                        if (!response.ok || typeof result.token !== 'string')
                            throw new Error('INVALID_RESPONSE');
                        item.centralToken = result.token;
                    }
                    item.user = yield (0, centralAccountLink_1.verifyCentralSession)(item.origin, item.centralToken, request);
                    return { status: 'approved', user: item.user };
                }
                finally {
                    item.busy = false;
                }
            });
        },
        take(handle) {
            return __awaiter(this, void 0, void 0, function* () {
                clearExpired();
                const item = pending.get(handle);
                if (!item || item.expiresAt <= Date.now() || !item.centralToken || !item.user)
                    throw new Error('EXPIRED');
                const user = yield (0, centralAccountLink_1.verifyCentralSession)(item.origin, item.centralToken, request);
                if (user.id !== item.user.id)
                    throw new Error('INVALID_SESSION');
                return { origin: item.origin, user, centralToken: item.centralToken };
            });
        },
        finish(handle) { pending.delete(handle); }
    };
}
