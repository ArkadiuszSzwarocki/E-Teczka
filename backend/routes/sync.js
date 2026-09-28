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
exports.parseCreatedDocuments = parseCreatedDocuments;
exports.createSyncRouter = createSyncRouter;
const express_1 = __importDefault(require("express"));
const folders_1 = require("../services/folders");
const errors_1 = require("../utils/errors");
const retentionUnits = new Set(['years', 'months', 'days', 'minutes']);
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function parseCreatedDocuments(changes) {
    var _a;
    const documents = asRecord((_a = asRecord(changes)) === null || _a === void 0 ? void 0 : _a.documents);
    if (!documents || documents.created === undefined)
        return [];
    if (!Array.isArray(documents.created))
        return null;
    const parsed = [];
    for (const value of documents.created) {
        const document = asRecord(value);
        if (!document || typeof document.title !== 'string' || typeof document.filePath !== 'string' || typeof document.mimeType !== 'string')
            return null;
        const folderId = Number(document.folderId);
        const retentionValue = document.retentionValue === undefined ? undefined : Number(document.retentionValue);
        const retentionUnit = document.retentionUnit;
        if (!Number.isInteger(folderId) || folderId < 1 || (retentionValue !== undefined && (!Number.isFinite(retentionValue) || retentionValue < 1)) || (retentionUnit !== undefined && (typeof retentionUnit !== 'string' || !retentionUnits.has(retentionUnit))) || (document.thumbnail !== undefined && document.thumbnail !== null && typeof document.thumbnail !== 'string'))
            return null;
        parsed.push({ title: document.title.trim(), filePath: document.filePath, mimeType: document.mimeType, folderId, retentionValue, retentionUnit: retentionUnit, thumbnail: document.thumbnail });
    }
    return parsed;
}
/** WatermelonDB synchronization endpoints. */
function createSyncRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const timestamp = req.query.lastPulledAt ? Number(req.query.lastPulledAt) : 0;
        if (!Number.isFinite(timestamp) || timestamp < 0)
            return res.status(400).json({ error: 'Nieprawidłowy znacznik synchronizacji.' });
        const lastPulledAt = new Date(timestamp);
        try {
            const createdFolders = yield prisma.folder.findMany({ where: { createdAt: { gt: lastPulledAt } } });
            const updatedFolders = yield prisma.folder.findMany({ where: { updatedAt: { gt: lastPulledAt }, createdAt: { lte: lastPulledAt } } });
            const createdDocs = yield prisma.document.findMany({ where: { createdAt: { gt: lastPulledAt } } });
            const updatedDocs = yield prisma.document.findMany({ where: { updatedAt: { gt: lastPulledAt }, createdAt: { lte: lastPulledAt } } });
            res.json({
                changes: {
                    folders: { created: createdFolders, updated: updatedFolders, deleted: [] },
                    documents: { created: createdDocs, updated: updatedDocs, deleted: [] },
                },
                timestamp: Date.now(),
            });
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[GET /api/sync] Błąd Pull:', details);
            res.status(500).json({ error: 'Błąd pobierania synchronizacji.', details });
        }
    }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const documents = parseCreatedDocuments((_a = req.body) === null || _a === void 0 ? void 0 : _a.changes);
        if (!documents)
            return res.status(400).json({ error: 'Nieprawidłowe dane synchronizacji.' });
        try {
            for (const document of documents) {
                if (!document.title || !(yield (0, folders_1.isDocumentFolder)(prisma, document.folderId))) {
                    return res.status(400).json({ error: 'Dokumenty można synchronizować wyłącznie do istniejących podkartotek.' });
                }
            }
            yield prisma.$transaction(documents.map((document) => {
                var _a, _b, _c;
                return prisma.document.create({ data: {
                        title: document.title, filePath: document.filePath, mimeType: document.mimeType, folderId: document.folderId,
                        retentionValue: (_a = document.retentionValue) !== null && _a !== void 0 ? _a : 5, retentionUnit: (_b = document.retentionUnit) !== null && _b !== void 0 ? _b : 'years', thumbnail: (_c = document.thumbnail) !== null && _c !== void 0 ? _c : null,
                    } });
            }));
            res.json({ success: true, createdDocuments: documents.length });
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[POST /api/sync] Błąd Push:', details);
            res.status(500).json({ error: 'Błąd zapisu synchronizacji.', details });
        }
    }));
    return router;
}
