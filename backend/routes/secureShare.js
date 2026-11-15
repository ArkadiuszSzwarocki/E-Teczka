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
exports.createSecureShareRouter = createSecureShareRouter;
const express_1 = __importDefault(require("express"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
const premium_1 = require("../middleware/premium");
const planRestrictions_1 = require("../services/planRestrictions");
const planLedger_1 = require("../services/planLedger");
const ocrPremium_1 = require("../services/ocrPremium");
function createSecureShareRouter(prisma) {
    const router = express_1.default.Router();
    const table = () => prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SecureShare (id TEXT PRIMARY KEY, ownerId INTEGER NOT NULL, documentId INTEGER NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL)');
    const config = () => { const base = process.env.ETECZKA_SHARE_SERVICE_URL, secret = process.env.ETECZKA_SHARE_SERVICE_SECRET; if (!base || !secret || secret.length < 32)
        return null; try {
        const url = new URL(base);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
            return null;
        return { base: url.origin, secret };
    }
    catch (_a) {
        return null;
    } };
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () { try {
        yield table();
        const owner = Number(res.locals.userId || 1);
        const shares = yield prisma.$queryRaw `SELECT id, documentId, expiresAt, createdAt FROM SecureShare WHERE ownerId=${owner} ORDER BY createdAt DESC`;
        res.setHeader('Cache-Control', 'no-store');
        res.json(shares);
    }
    catch (_a) {
        res.status(500).json({ error: 'Nie udało się pobrać linków.' });
    } }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            if (!(yield (0, premium_1.hasPremium)(prisma, res)))
                return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Bezpieczne linki wymagają planu Premium.' });
            const service = config();
            if (!service)
                return res.status(503).json({ error: 'Usługa linków nie jest skonfigurowana. Potrzebny jest serwer HTTPS na NAS-ie.' });
            const owner = Number(res.locals.userId || 1), id = Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.documentId), expires = Number((_b = req.body) === null || _b === void 0 ? void 0 : _b.expiresInSeconds), pin = (_c = req.body) === null || _c === void 0 ? void 0 : _c.pin, singleUse = (_d = req.body) === null || _d === void 0 ? void 0 : _d.singleUse;
            if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(expires) || expires < 60 || expires > 604800 || (pin !== undefined && !/^\d{6}$/.test(pin)) || (singleUse !== undefined && typeof singleUse !== 'boolean'))
                return res.status(400).json({ error: 'Nieprawidłowe ustawienia linku.' });
            const doc = yield prisma.document.findFirst({ where: { id, folder: { ownerId: owner }, isDeleted: false }, select: { id: true, filePath: true, mimeType: true } });
            if (!doc)
                return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
            const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, owner, yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
            if (active && !active.has(id))
                return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument jest tylko do odczytu w obecnym planie.' });
            if (!['application/pdf', 'image/jpeg', 'image/png'].includes(doc.mimeType) || node_path_1.default.basename(doc.filePath) !== doc.filePath)
                return res.status(400).json({ error: 'Obsługiwane są dokumenty PDF, JPG i PNG.' });
            const stat = yield promises_1.default.stat(node_path_1.default.join(paths_1.uploadsDir, doc.filePath));
            if (stat.size > 50 * 1024 * 1024)
                return res.status(413).json({ error: 'Maksymalny rozmiar dokumentu to 50 MB.' });
            const bytes = yield promises_1.default.readFile(node_path_1.default.join(paths_1.uploadsDir, doc.filePath));
            const remote = yield fetch(`${service.base}/admin/shares`, { method: 'POST', headers: { Authorization: `Bearer ${service.secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: bytes.toString('base64'), mimeType: doc.mimeType, expiresInSeconds: expires, pin, singleUse }), signal: AbortSignal.timeout(30000) });
            const result = yield remote.json();
            if (!remote.ok || !result.id || !result.url || !result.expiresAt || !/^[a-f0-9]{64}$/.test(result.id))
                return res.status(502).json({ error: 'Serwer linków odrzucił dokument.' });
            const link = new URL(result.url);
            if (link.protocol !== 'https:' || link.origin !== service.base || link.pathname !== '/s' || !/^#[A-Za-z0-9_-]{43}$/.test(link.hash))
                return res.status(502).json({ error: 'Serwer zwrócił nieprawidłowy adres linku.' });
            yield table();
            try {
                yield prisma.$executeRaw `INSERT INTO SecureShare(id,ownerId,documentId,expiresAt,createdAt) VALUES (${result.id},${owner},${id},${result.expiresAt},${new Date().toISOString()})`;
            }
            catch (error) {
                yield fetch(`${service.base}/admin/shares/${result.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${service.secret}` }, signal: AbortSignal.timeout(10000) }).catch(() => undefined);
                throw error;
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.status(201).json({ id: result.id, url: result.url, expiresAt: result.expiresAt });
        }
        catch (error) {
            console.error('[share] Błąd tworzenia linku:', error instanceof Error ? error.message : 'nieznany');
            return res.status(500).json({ error: 'Nie udało się utworzyć linku. Sprawdź połączenie z serwerem.' });
        }
    }));
    router.delete('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () { try {
        const service = config();
        if (!service)
            return res.status(503).json({ error: 'Usługa linków nie jest skonfigurowana.' });
        const owner = Number(res.locals.userId || 1), id = req.params.id;
        if (!/^[a-f0-9]{64}$/.test(id))
            return res.sendStatus(400);
        yield table();
        const found = yield prisma.$queryRaw `SELECT id FROM SecureShare WHERE ownerId=${owner} AND id=${id}`;
        if (!found.length)
            return res.sendStatus(404);
        const result = yield fetch(`${service.base}/admin/shares/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${service.secret}` }, signal: AbortSignal.timeout(10000) });
        if (!result.ok)
            return res.status(502).json({ error: 'Nie udało się unieważnić linku na serwerze.' });
        yield prisma.$executeRaw `DELETE FROM SecureShare WHERE ownerId=${owner} AND id=${id}`;
        return res.status(204).end();
    }
    catch (_a) {
        return res.status(503).json({ error: 'Nie udało się połączyć z serwerem linków.' });
    } }));
    return router;
}
