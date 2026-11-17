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
Object.defineProperty(exports, "__esModule", { value: true });
exports.centralAccountOrigin = centralAccountOrigin;
exports.verifyCentralSession = verifyCentralSession;
exports.createCentralAccountLinks = createCentralAccountLinks;
const sessionPolicy_1 = require("./sessionPolicy");
const node_crypto_1 = require("node:crypto");
function centralAccountOrigin(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        return (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
    }
    catch (_a) {
        return null;
    }
}
function verifyCentralSession(origin_1, token_1) {
    return __awaiter(this, arguments, void 0, function* (origin, token, request = fetch) {
        const safeOrigin = centralAccountOrigin(origin);
        if (!safeOrigin || !/^[A-Za-z0-9_-]{43}$/.test(token))
            throw new Error('INVALID_SESSION');
        const response = yield request(`${safeOrigin}/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok)
            throw new Error('INVALID_SESSION');
        const user = yield response.json();
        if (typeof user.id !== 'string' || !/^[a-f0-9]{32}$/.test(user.id) || typeof user.email !== 'string' || !user.email || (user.name !== null && typeof user.name !== 'string'))
            throw new Error('INVALID_SESSION');
        return { id: user.id, email: user.email, name: user.name };
    });
}
function createCentralAccountLinks(prisma) {
    const table = () => prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS CentralAccountLink (centralOrigin TEXT NOT NULL, centralId TEXT NOT NULL, localUserId INTEGER NOT NULL UNIQUE, createdAt TEXT NOT NULL, PRIMARY KEY(centralOrigin, centralId), FOREIGN KEY(localUserId) REFERENCES User(id))');
    return {
        localUserId(localToken) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                if (typeof localToken !== 'string' || localToken.length < 1 || localToken.length > 4096)
                    return null;
                const tokenHash = (0, node_crypto_1.createHash)('sha256').update(localToken).digest('hex');
                const session = yield prisma.authSession.findFirst({ where: Object.assign({ tokenHash }, (0, sessionPolicy_1.activeSessionWhere)()), select: { userId: true } });
                return (_a = session === null || session === void 0 ? void 0 : session.userId) !== null && _a !== void 0 ? _a : null;
            });
        },
        link(origin, centralId, localUserId) {
            return __awaiter(this, void 0, void 0, function* () {
                yield table();
                yield prisma.$executeRaw `INSERT INTO CentralAccountLink(centralOrigin, centralId, localUserId, createdAt) VALUES (${origin}, ${centralId}, ${localUserId}, ${new Date().toISOString()})`;
            });
        },
        find(origin, centralId) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                yield table();
                const rows = yield prisma.$queryRaw `SELECT localUserId FROM CentralAccountLink WHERE centralOrigin = ${origin} AND centralId = ${centralId}`;
                return (_b = (_a = rows[0]) === null || _a === void 0 ? void 0 : _a.localUserId) !== null && _b !== void 0 ? _b : null;
            });
        },
        unlink(origin, centralId, localUserId) {
            return __awaiter(this, void 0, void 0, function* () {
                yield table();
                const changed = yield prisma.$executeRaw `DELETE FROM CentralAccountLink WHERE centralOrigin = ${origin} AND centralId = ${centralId} AND localUserId = ${localUserId}`;
                return changed === 1;
            });
        },
        revokeLocalSessions(localUserId) {
            return __awaiter(this, void 0, void 0, function* () {
                const deleted = yield prisma.authSession.deleteMany({ where: { userId: localUserId } });
                return deleted.count;
            });
        }
    };
}
