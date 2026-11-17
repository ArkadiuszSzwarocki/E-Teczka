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
exports.createOcrRouter = createOcrRouter;
const express_1 = __importDefault(require("express"));
const ocrPremium_1 = require("../services/ocrPremium");
const ocrText_1 = require("../services/ocrText");
const planRestrictions_1 = require("../services/planRestrictions");
const planLedger_1 = require("../services/planLedger");
function createOcrRouter(prisma, queue) {
    const router = express_1.default.Router();
    router.use((req, res, next) => __awaiter(this, void 0, void 0, function* () {
        try {
            if (!(yield (0, ocrPremium_1.hasOcrPremium)(prisma, res, req.method === 'POST')))
                return res.status(402).json({ error: 'Rozpocznij okres próbny OCR albo wybierz Premium, jeśli okres próbny się zakończył.', code: 'OCR_UNAVAILABLE' });
            next();
        }
        catch (error) {
            next(error);
        }
    }));
    router.get('/search', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const query = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase('pl') : '';
        if (!query || query.length > 200)
            return res.status(400).json({ error: 'Podaj tekst wyszukiwania (maksymalnie 200 znaków).' });
        try {
            const documents = yield prisma.document.findMany({ where: { folder: { ownerId: Number(res.locals.userId || 1) }, ocrText: { not: null } }, select: { id: true, ocrText: true } });
            const ids = [];
            for (const document of documents)
                if ((0, ocrText_1.readOcrText)(document.ocrText).toLocaleLowerCase('pl').includes(query))
                    ids.push(document.id);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ ids });
        }
        catch (_a) {
            res.status(500).json({ error: 'Nie udało się przeszukać rozpoznanego tekstu.' });
        }
    }));
    router.post('/batch', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ids = (_a = req.body) === null || _a === void 0 ? void 0 : _a.documentIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1))
            return res.status(400).json({ error: 'Wybierz od 1 do 100 dokumentów.' });
        const uniqueIds = [...new Set(ids)];
        try {
            const documents = yield prisma.document.findMany({ where: { id: { in: uniqueIds }, folder: { ownerId: Number(res.locals.userId || 1) }, isDeleted: false }, select: { id: true } });
            if (documents.length !== uniqueIds.length)
                return res.status(404).json({ error: 'Nie znaleziono wszystkich dokumentów.' });
            const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, Number(res.locals.userId || 1), yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
            if (active && uniqueIds.some(id => !active.has(id)))
                return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Niektóre dokumenty są tylko do odczytu z powodu limitu planu.' });
            for (const document of documents)
                queue.enqueue(document.id, (0, ocrPremium_1.ocrOwnerKey)(res));
            return res.status(202).json({ queued: documents.length });
        }
        catch (_b) {
            return res.status(500).json({ error: 'Nie udało się dodać dokumentów do kolejki OCR.' });
        }
    }));
    router.use('/:id', (req, res, next) => __awaiter(this, void 0, void 0, function* () {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1)
            return res.status(400).json({ error: 'Nieprawidłowy dokument.' });
        const found = yield prisma.document.findFirst({ where: { id, folder: { ownerId: Number(res.locals.userId || 1) }, isDeleted: false }, select: { id: true } });
        if (!found)
            return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
        const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, Number(res.locals.userId || 1), yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
        if (active && !active.has(id))
            return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument jest tylko do odczytu z powodu limitu planu.' });
        next();
    }));
    router.post('/:id', (req, res) => {
        try {
            queue.enqueue(Number(req.params.id), (0, ocrPremium_1.ocrOwnerKey)(res));
            res.status(202).json({ status: 'queued' });
        }
        catch (_a) {
            res.status(500).json({ error: 'Nie udało się dodać dokumentu do kolejki OCR.' });
        }
    });
    router.get('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const document = yield prisma.document.findUnique({ where: { id: Number(req.params.id) }, select: { ocrText: true } });
            const status = queue.status(Number(req.params.id), (0, ocrPremium_1.ocrOwnerKey)(res));
            const fullText = (document === null || document === void 0 ? void 0 : document.ocrText) ? (0, ocrText_1.readOcrText)(document.ocrText) : '';
            const rawOffset = Number(req.query.offset);
            const rawLimit = Number(req.query.limit);
            const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
            const hasLimit = Number.isInteger(rawLimit) && rawLimit > 0;
            const text = hasLimit ? fullText.slice(offset, offset + Math.min(rawLimit, 100000)) : fullText;
            res.setHeader('Cache-Control', 'no-store');
            res.json(Object.assign(Object.assign({}, status), { text, totalLength: fullText.length, offset, hasMore: offset + text.length < fullText.length }));
        }
        catch (_a) {
            res.status(500).json({ error: 'Nie udało się odczytać wyniku OCR.' });
        }
    }));
    router.put('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const text = (_a = req.body) === null || _a === void 0 ? void 0 : _a.text;
        if (typeof text !== 'string' || text.length > 2000000)
            return res.status(400).json({ error: 'Tekst OCR może mieć maksymalnie 2 000 000 znaków.' });
        try {
            const status = queue.status(Number(req.params.id), (0, ocrPremium_1.ocrOwnerKey)(res));
            if (status.state === 'queued' || status.state === 'processing')
                return res.status(409).json({ error: 'Poczekaj na zakończenie rozpoznawania przed zapisem zmian.' });
            const result = yield prisma.document.updateMany({ where: { id: Number(req.params.id), folder: { ownerId: Number(res.locals.userId || 1) }, isDeleted: false }, data: { ocrText: (0, ocrText_1.protectOcrText)(text) } });
            if (!result.count)
                return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
            res.json({ success: true });
        }
        catch (_b) {
            res.status(500).json({ error: 'Nie udało się zapisać tekstu OCR.' });
        }
    }));
    return router;
}
