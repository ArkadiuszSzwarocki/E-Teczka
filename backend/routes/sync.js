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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSyncChanges = parseSyncChanges;
exports.createSyncRouter = createSyncRouter;
const express_1 = __importDefault(require("express"));
const errors_1 = require("../utils/errors");
const syncReceipt_1 = require("../services/syncReceipt");
const ocrPremium_1 = require("../services/ocrPremium");
const planLedger_1 = require("../services/planLedger");
const planRestrictions_1 = require("../services/planRestrictions");
const duplicateDocuments_1 = require("../services/duplicateDocuments");
const paths_1 = require("../config/paths");
const path_1 = __importDefault(require("path"));
const units = new Set(['years', 'months', 'days', 'minutes']);
const record = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const date = (v) => typeof v === 'string' && Number.isFinite(new Date(v).getTime());
function parseSyncChanges(changes) {
    const root = record(changes), fs = record(root === null || root === void 0 ? void 0 : root.folders), ds = record(root === null || root === void 0 ? void 0 : root.documents);
    if (!root)
        return null;
    const ids = (v) => {
        if (v === undefined)
            return [];
        if (!Array.isArray(v))
            return null;
        const parsed = v.map(Number);
        return parsed.every(n => Number.isInteger(n) && n > 0) ? parsed : null;
    };
    const folder = (v) => { const x = record(v); if (!x || typeof x.name !== 'string')
        return null; const p = x.parentId == null ? null : Number(x.parentId), o = x.order === undefined ? 0 : Number(x.order); if (p !== null && (!Number.isInteger(p) || p < 1) || !Number.isInteger(o))
        return null; return { id: x.id === undefined ? undefined : Number(x.id), clientId: typeof x.clientId === 'string' ? x.clientId : undefined, name: x.name.trim(), parentId: p, order: o, updatedAt: date(x.updatedAt) ? String(x.updatedAt) : undefined }; };
    const doc = (v) => { const x = record(v); if (!x || typeof x.title !== 'string' || typeof x.filePath !== 'string' || typeof x.mimeType !== 'string')
        return null; const f = Number(x.folderId), rv = x.retentionValue === undefined ? undefined : Number(x.retentionValue), ru = x.retentionUnit; if (!Number.isInteger(f) || f < 1 || (rv !== undefined && (!Number.isFinite(rv) || rv < 1)) || (ru !== undefined && (typeof ru !== 'string' || !units.has(ru))))
        return null; return { id: x.id === undefined ? undefined : Number(x.id), title: x.title.trim(), filePath: x.filePath, mimeType: x.mimeType, folderId: f, retentionValue: rv, retentionUnit: ru, thumbnail: x.thumbnail, isArchived: Boolean(x.isArchived), isDeleted: Boolean(x.isDeleted), updatedAt: date(x.updatedAt) ? String(x.updatedAt) : undefined }; };
    const list = (v, fn) => v === undefined ? [] : Array.isArray(v) ? v.map(item => {
        const value = record(item);
        if (!value || (value.id !== undefined && (!Number.isInteger(Number(value.id)) || Number(value.id) < 1)) || (value.updatedAt !== undefined && !date(value.updatedAt)))
            return null;
        if (fn === doc && ((value.isArchived !== undefined && typeof value.isArchived !== 'boolean') || (value.isDeleted !== undefined && typeof value.isDeleted !== 'boolean') || (value.retentionEnabled !== undefined && typeof value.retentionEnabled !== 'boolean') || (value.retentionValue !== undefined && !Number.isInteger(Number(value.retentionValue)))))
            return null;
        return fn(item);
    }) : null;
    const fc = list(fs === null || fs === void 0 ? void 0 : fs.created, folder), fu = list(fs === null || fs === void 0 ? void 0 : fs.updated, folder), dc = list(ds === null || ds === void 0 ? void 0 : ds.created, doc), du = list(ds === null || ds === void 0 ? void 0 : ds.updated, doc);
    if ([fc, fu, dc, du].some(x => x === null || x.some(y => y === null)))
        return null;
    const deletedFolders = ids(fs === null || fs === void 0 ? void 0 : fs.deleted), deletedDocuments = ids(ds === null || ds === void 0 ? void 0 : ds.deleted);
    if (!deletedFolders || !deletedDocuments)
        return null;
    return { folders: { created: fc, updated: fu, deleted: deletedFolders }, documents: { created: dc, updated: du, deleted: deletedDocuments } };
}
function createSyncRouter(prisma) {
    const router = express_1.default.Router();
    const owner = (res) => Number(res.locals.userId || 1);
    router.post('/operation', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const operationId = (_a = req.body) === null || _a === void 0 ? void 0 : _a.operationId;
        const operation = (_b = req.body) === null || _b === void 0 ? void 0 : _b.operation;
        if (typeof operationId === 'string' && operationId.trim() && operationId.length <= 128 && (operation === null || operation === void 0 ? void 0 : operation.entity) === 'folders' && (operation === null || operation === void 0 ? void 0 : operation.type) === 'updated') {
            const changes = parseSyncChanges({ folders: { updated: [operation.value] } });
            const folder = changes === null || changes === void 0 ? void 0 : changes.folders.updated[0];
            if (!(folder === null || folder === void 0 ? void 0 : folder.id) || !folder.name || !folder.updatedAt)
                return res.status(400).json({ error: 'Zmiana kartoteki wymaga identyfikatora, nazwy i daty.' });
            const ownerId = owner(res);
            try {
                const receipt = yield (0, syncReceipt_1.withSyncReceipt)(prisma, `user:${ownerId}`, operationId, operation, (tx) => __awaiter(this, void 0, void 0, function* () {
                    const current = yield tx.folder.findFirst({ where: { id: folder.id, ownerId } });
                    if (!current)
                        throw new Error('Nie znaleziono kartoteki.');
                    if (current.updatedAt > new Date(folder.updatedAt))
                        return { id: current.id, conflict: true };
                    const updated = yield tx.folder.update({ where: { id: current.id }, data: { name: folder.name, order: folder.order } });
                    return { id: updated.id, conflict: false };
                }));
                return res.json(Object.assign({ success: true }, receipt));
            }
            catch (error) {
                console.error('[POST /api/sync/operation]', (0, errors_1.errorMessage)(error));
                return res.status(409).json({ error: 'Nie udało się zastosować zmiany kartoteki.' });
            }
        }
        if (typeof operationId === 'string' && operationId.trim() && operationId.length <= 128 && (operation === null || operation === void 0 ? void 0 : operation.entity) === 'folders' && (operation === null || operation === void 0 ? void 0 : operation.type) === 'deleted') {
            const id = Number((_c = operation.value) === null || _c === void 0 ? void 0 : _c.id);
            if (!Number.isInteger(id) || id < 1 || !date((_d = operation.value) === null || _d === void 0 ? void 0 : _d.updatedAt))
                return res.status(400).json({ error: 'Usunięcie kartoteki wymaga identyfikatora i daty.' });
            const ownerId = owner(res);
            try {
                const receipt = yield (0, syncReceipt_1.withSyncReceipt)(prisma, `user:${ownerId}`, operationId, operation, (tx) => __awaiter(this, void 0, void 0, function* () {
                    const folder = yield tx.folder.findFirst({ where: { id, ownerId }, select: { id: true, updatedAt: true } });
                    if (!folder)
                        throw new Error('Nie znaleziono kartoteki.');
                    if (folder.updatedAt > new Date(operation.value.updatedAt))
                        throw new Error('Kartoteka została zmieniona na komputerze.');
                    const [documents, children] = yield Promise.all([tx.document.count({ where: { folderId: id } }), tx.folder.count({ where: { parentId: id } })]);
                    if (documents || children)
                        throw new Error('Kartoteka nie jest pusta.');
                    yield tx.folder.delete({ where: { id } });
                    return { id };
                }));
                return res.json(Object.assign({ success: true }, receipt));
            }
            catch (error) {
                console.error('[POST /api/sync/operation]', (0, errors_1.errorMessage)(error));
                return res.status(409).json({ error: 'Nie udało się usunąć kartoteki. Sprawdź, czy jest pusta.' });
            }
        }
        if (typeof operationId === 'string' && operationId.trim() && operationId.length <= 128 && (operation === null || operation === void 0 ? void 0 : operation.entity) === 'documents' && (operation === null || operation === void 0 ? void 0 : operation.type) === 'updated') {
            const changes = parseSyncChanges({ documents: { updated: [operation.value] } });
            const document = changes === null || changes === void 0 ? void 0 : changes.documents.updated[0];
            if (!(document === null || document === void 0 ? void 0 : document.id) || !document.updatedAt)
                return res.status(400).json({ error: 'Zmiana dokumentu wymaga identyfikatora i daty.' });
            if (operation.value.retentionEnabled !== undefined && typeof operation.value.retentionEnabled !== 'boolean')
                return res.status(400).json({ error: 'Nieprawidłowe ustawienie retencji.' });
            const ownerId = owner(res);
            try {
                const activeDocuments = yield (0, planRestrictions_1.activeDocumentIds)(prisma, ownerId, yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
                const receipt = yield (0, syncReceipt_1.withSyncReceipt)(prisma, `user:${ownerId}`, operationId, operation, (tx) => __awaiter(this, void 0, void 0, function* () {
                    const current = yield tx.document.findFirst({ where: { id: document.id, folder: { ownerId } } });
                    if (!current)
                        throw new Error('Nie znaleziono dokumentu.');
                    if (activeDocuments !== null && !activeDocuments.has(current.id)) {
                        const onlyDelete = document.isDeleted === true && document.title === current.title && document.folderId === current.folderId && document.isArchived === current.isArchived && (document.retentionValue === undefined || document.retentionValue === current.retentionValue) && (document.retentionUnit === undefined || document.retentionUnit === current.retentionUnit) && (operation.value.retentionEnabled === undefined || operation.value.retentionEnabled === current.retentionEnabled);
                        if (!onlyDelete)
                            throw new planLedger_1.PlanLimitError('dokumenty tylko do odczytu', 0);
                    }
                    if (current.updatedAt > new Date(document.updatedAt))
                        return { id: current.id, conflict: true };
                    const destination = yield tx.folder.findFirst({ where: { id: document.folderId, ownerId }, select: { id: true } });
                    if (!destination)
                        throw new Error('Nie znaleziono kartoteki docelowej.');
                    if (current.folderId !== document.folderId || (current.isDeleted && !document.isDeleted)) {
                        if (path_1.default.basename(current.filePath) !== current.filePath)
                            throw new Error('Nieprawidłowy plik dokumentu.');
                        yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId, document.folderId, yield (0, duplicateDocuments_1.hashFile)(path_1.default.join(paths_1.uploadsDir, current.filePath)), current.id);
                    }
                    const updated = yield tx.document.update({ where: { id: current.id }, data: { title: document.title, folderId: document.folderId, retentionValue: document.retentionValue, retentionUnit: document.retentionUnit, retentionEnabled: operation.value.retentionEnabled, isArchived: document.isArchived, isDeleted: document.isDeleted, deletedAt: document.isDeleted ? new Date() : null } });
                    return { id: updated.id, conflict: false };
                }));
                return res.json(Object.assign({ success: true }, receipt));
            }
            catch (error) {
                if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                    return res.status(409).json({ code: error.code, error: error.message });
                if (error instanceof planLedger_1.PlanLimitError)
                    return res.status(403).json({ code: error.code, error: 'Dokument przekracza limit planu i jest tylko do odczytu.' });
                console.error('[POST /api/sync/operation]', (0, errors_1.errorMessage)(error));
                return res.status(409).json({ error: 'Nie udało się zastosować zmiany dokumentu.' });
            }
        }
        if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 128 || (operation === null || operation === void 0 ? void 0 : operation.entity) !== 'folders' || (operation === null || operation === void 0 ? void 0 : operation.type) !== 'created') {
            return res.status(400).json({ error: 'Nieprawidłowa lub nieobsługiwana operacja synchronizacji.' });
        }
        const changes = parseSyncChanges({ folders: { created: [operation.value] } });
        const folder = changes === null || changes === void 0 ? void 0 : changes.folders.created[0];
        if (!folder || !folder.name || !folder.clientId || folder.id !== undefined)
            return res.status(400).json({ error: 'Nieprawidłowe dane kartoteki.' });
        const ownerId = owner(res);
        try {
            const receipt = yield (0, syncReceipt_1.withSyncReceipt)(prisma, `user:${ownerId}`, operationId, operation, (tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                if (folder.parentId !== null && folder.parentId !== undefined) {
                    const parent = yield tx.folder.findFirst({ where: { id: folder.parentId, ownerId }, select: { id: true } });
                    if (!parent)
                        throw new Error('Nie znaleziono nadrzędnej kartoteki.');
                }
                const created = yield tx.folder.create({ data: { name: folder.name, parentId: (_a = folder.parentId) !== null && _a !== void 0 ? _a : null, order: (_b = folder.order) !== null && _b !== void 0 ? _b : 0, ownerId } });
                return { clientId: folder.clientId, id: created.id };
            }));
            return res.json(Object.assign({ success: true }, receipt));
        }
        catch (error) {
            console.error('[POST /api/sync/operation]', (0, errors_1.errorMessage)(error));
            return res.status(409).json({ error: 'Nie udało się zastosować operacji synchronizacji.' });
        }
    }));
    router.get('/', (req, res) => __awaiter(this, void 0, void 0, function* () { const n = req.query.lastPulledAt ? Number(req.query.lastPulledAt) : 0; if (!Number.isFinite(n) || n < 0)
        return res.status(400).json({ error: 'Nieprawidłowy znacznik synchronizacji.' }); const since = new Date(Math.max(0, n - 1000)), user = owner(res), pullStartedAt = Date.now(); try {
        const [cf, uf, cd, ud] = yield Promise.all([prisma.folder.findMany({ where: { ownerId: user, createdAt: { gt: since } } }), prisma.folder.findMany({ where: { ownerId: user, updatedAt: { gt: since }, createdAt: { lte: since } } }), prisma.document.findMany({ where: { OR: [{ userId: user }, { folder: { ownerId: user } }], createdAt: { gt: since } } }), prisma.document.findMany({ where: { OR: [{ userId: user }, { folder: { ownerId: user } }], updatedAt: { gt: since }, createdAt: { lte: since } } })]);
        res.json({ changes: { folders: { created: cf, updated: uf, deleted: [] }, documents: { created: cd.map((_a) => {
                        var { ocrText: _ocrText } = _a, document = __rest(_a, ["ocrText"]);
                        return document;
                    }), updated: ud.map((_a) => {
                        var { ocrText: _ocrText } = _a, document = __rest(_a, ["ocrText"]);
                        return document;
                    }), deleted: [] } }, timestamp: pullStartedAt });
    }
    catch (e) {
        const details = (0, errors_1.errorMessage)(e);
        console.error('[GET /api/sync]', details);
        res.status(500).json({ error: 'Błąd pobierania synchronizacji.', details });
    } }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () { var _a, _b, _c, _d; const changes = parseSyncChanges((_a = req.body) === null || _a === void 0 ? void 0 : _a.changes); if (!changes)
        return res.status(400).json({ error: 'Nieprawidłowe dane synchronizacji.' }); const user = owner(res), folderMap = {}, isOwnFolder = (id) => __awaiter(this, void 0, void 0, function* () { return Boolean(yield prisma.folder.findFirst({ where: { id, ownerId: user }, select: { id: true } })); }); try {
        const plan = yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res));
        const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, user, plan);
        if (active && [...changes.documents.created, ...changes.documents.updated].some(d => d.id && !active.has(d.id)))
            return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument przekracza limit planu i jest tylko do odczytu.' });
        let applied = 0;
        for (const f of changes.folders.created) {
            if (!f.name)
                continue;
            const parent = f.parentId && (yield isOwnFolder(f.parentId)) ? f.parentId : null;
            const x = yield prisma.folder.create({ data: { name: f.name, parentId: parent, order: f.order || 0, ownerId: user } });
            if (f.clientId)
                folderMap[f.clientId] = x.id;
            applied++;
        }
        for (const f of changes.folders.updated) {
            if (!f.id || !(yield isOwnFolder(f.id)))
                continue;
            const x = yield prisma.folder.findUnique({ where: { id: f.id } });
            if (f.updatedAt && x && x.updatedAt > new Date(f.updatedAt))
                continue;
            yield prisma.folder.update({ where: { id: f.id }, data: { name: f.name, order: f.order } });
            applied++;
        }
        if (changes.folders.deleted.length) {
            yield prisma.folder.deleteMany({ where: { id: { in: changes.folders.deleted }, ownerId: user } });
            applied += changes.folders.deleted.length;
        }
        for (const d of [...changes.documents.created, ...changes.documents.updated]) {
            const folder = yield prisma.folder.findFirst({ where: { id: d.folderId, ownerId: user }, select: { id: true } });
            if (!folder || !d.title)
                continue;
            const old = d.id ? yield prisma.document.findFirst({ where: { id: d.id, OR: [{ userId: user }, { folder: { ownerId: user } }] } }) : null;
            if (old && d.updatedAt && old.updatedAt > new Date(d.updatedAt))
                continue;
            const data = { title: d.title, filePath: d.filePath, mimeType: d.mimeType, folderId: d.folderId, retentionValue: (_b = d.retentionValue) !== null && _b !== void 0 ? _b : 5, retentionUnit: (_c = d.retentionUnit) !== null && _c !== void 0 ? _c : 'years', thumbnail: (_d = d.thumbnail) !== null && _d !== void 0 ? _d : null, isArchived: Boolean(d.isArchived), isDeleted: Boolean(d.isDeleted), deletedAt: d.isDeleted ? new Date() : null, userId: user };
            if (old && (old.folderId !== d.folderId || (old.isDeleted && !d.isDeleted))) {
                if (path_1.default.basename(old.filePath) !== old.filePath)
                    throw new Error('Nieprawidłowy plik dokumentu.');
                yield (0, duplicateDocuments_1.assertUniqueDocument)(prisma, user, d.folderId, yield (0, duplicateDocuments_1.hashFile)(path_1.default.join(paths_1.uploadsDir, old.filePath)), old.id);
            }
            if (old)
                yield prisma.document.update({ where: { id: old.id }, data });
            else
                yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () { if (path_1.default.basename(d.filePath) !== d.filePath)
                    throw new Error('Nieprawidłowy plik dokumentu.'); yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, user, d.folderId, yield (0, duplicateDocuments_1.hashFile)(path_1.default.join(paths_1.uploadsDir, d.filePath))); yield (0, planLedger_1.checkDocumentCapacity)(tx, user, plan, 1); yield tx.document.create({ data }); }));
            applied++;
        }
        if (changes.documents.deleted.length) {
            yield prisma.document.updateMany({ where: { id: { in: changes.documents.deleted }, OR: [{ userId: user }, { folder: { ownerId: user } }] }, data: { isDeleted: true, deletedAt: new Date() } });
            applied += changes.documents.deleted.length;
        }
        res.json({ success: true, applied, folderMap, timestamp: Date.now() });
    }
    catch (e) {
        if (e instanceof duplicateDocuments_1.DuplicateDocumentError)
            return res.status(409).json({ code: e.code, error: e.message });
        if (e instanceof planLedger_1.PlanLimitError)
            return res.status(403).json({ code: e.code, error: e.message });
        const details = (0, errors_1.errorMessage)(e);
        console.error('[POST /api/sync]', details);
        res.status(500).json({ error: 'Błąd zapisu synchronizacji.', details });
    } }));
    return router;
}
