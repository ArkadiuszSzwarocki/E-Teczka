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
exports.createDocumentRouter = createDocumentRouter;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const paths_1 = require("../config/paths");
const folders_1 = require("../services/folders");
const errors_1 = require("../utils/errors");
const premium_1 = require("../middleware/premium");
const pdf_lib_1 = require("pdf-lib");
const ocrEnqueue_1 = require("../services/ocrEnqueue");
const ocrPremium_1 = require("../services/ocrPremium");
const planLedger_1 = require("../services/planLedger");
const mergeDocuments_1 = require("../services/mergeDocuments");
const base64DataUrl_1 = require("../services/base64DataUrl");
const tagOwnership_1 = require("../services/tagOwnership");
const planRestrictions_1 = require("../services/planRestrictions");
const duplicateDocuments_1 = require("../services/duplicateDocuments");
const retentionUnits = new Set(['years', 'months', 'days', 'minutes']);
function documentUpdate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        return null;
    const source = body;
    const allowed = new Set(['title', 'folderId', 'retentionEnabled', 'retentionValue', 'retentionUnit', 'isArchived', 'isDeleted', 'deletedAt', 'tagIds']);
    if (Object.keys(source).some((key) => !allowed.has(key)))
        return null;
    if (source.title !== undefined && (typeof source.title !== 'string' || !source.title.trim() || source.title.length > 255))
        return null;
    if (source.folderId !== undefined && (!Number.isInteger(Number(source.folderId)) || Number(source.folderId) < 1))
        return null;
    if (source.retentionEnabled !== undefined && typeof source.retentionEnabled !== 'boolean')
        return null;
    if (source.retentionValue !== undefined && (!Number.isInteger(Number(source.retentionValue)) || Number(source.retentionValue) < 1))
        return null;
    if (source.retentionUnit !== undefined && (typeof source.retentionUnit !== 'string' || !retentionUnits.has(source.retentionUnit)))
        return null;
    if (source.isArchived !== undefined && typeof source.isArchived !== 'boolean')
        return null;
    if (source.isDeleted !== undefined && typeof source.isDeleted !== 'boolean')
        return null;
    if (source.deletedAt !== undefined && source.deletedAt !== null && typeof source.deletedAt !== 'string')
        return null;
    if (source.createdAt !== undefined && (typeof source.createdAt !== 'string' || Number.isNaN(new Date(source.createdAt).getTime())))
        return null;
    if (source.tagIds !== undefined && (!Array.isArray(source.tagIds) || source.tagIds.some((id) => !Number.isInteger(Number(id)) || Number(id) < 1)))
        return null;
    return source;
}
/** Document listing, metadata changes and desktop Base64 uploads. */
function createDocumentRouter(prisma, ocrQueue) {
    const router = express_1.default.Router();
    const ownerId = (res) => Number(res.locals.userId || 1);
    // Delete only records currently in this owner's trash; shared file paths remain intact.
    const removeTrashed = (owner, id) => __awaiter(this, void 0, void 0, function* () {
        const where = Object.assign({ isDeleted: true, folder: { ownerId: owner } }, (id === undefined ? {} : { id }));
        const records = yield prisma.document.findMany({ where, select: { id: true, filePath: true } });
        const ids = records.map(record => record.id);
        if (ids.length)
            yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield tx.documentTag.deleteMany({ where: { documentId: { in: ids } } });
                yield tx.document.deleteMany({ where: Object.assign(Object.assign({}, where), { id: { in: ids } }) });
            }));
        let failedFiles = 0;
        for (const file of new Set(records.map(record => record.filePath))) {
            if (!file || path_1.default.basename(file) !== file) {
                failedFiles++;
                continue;
            }
            if (yield prisma.document.count({ where: { filePath: file } }))
                continue;
            try {
                yield fs_1.default.promises.unlink(path_1.default.join(paths_1.uploadsDir, file));
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    failedFiles++;
                    console.error('[trash] Nie udało się usunąć pliku:', (0, errors_1.errorMessage)(error));
                }
            }
        }
        return { deleted: records.length, failedFiles };
    });
    router.post('/empty-trash', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            res.json(yield removeTrashed(ownerId(res)));
        }
        catch (error) {
            console.error('[trash] Błąd opróżniania:', (0, errors_1.errorMessage)(error));
            res.status(500).json({ error: 'Nie udało się opróżnić kosza.' });
        }
    }));
    router.use('/:id', (req, res, next) => __awaiter(this, void 0, void 0, function* () {
        if (req.method === 'POST' && (req.params.id === 'export-pdf' || req.params.id === 'upload-base64'))
            return next();
        if (!/^\d+$/.test(req.params.id) || Number(req.params.id) < 1)
            return res.status(400).json({ error: 'Nieprawidłowy identyfikator dokumentu.' });
        const document = yield prisma.document.findFirst({ where: { id: Number(req.params.id), folder: { ownerId: ownerId(res) } } });
        if (!document)
            return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
        res.locals.currentDocument = document;
        next();
    }));
    router.get('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const folderId = req.query.folderId;
            const where = folderId ? { folderId: Number(folderId), folder: { ownerId: ownerId(res) } } : { folder: { ownerId: ownerId(res) } };
            const records = yield prisma.document.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: { tags: { include: { tag: true } }, user: { select: { name: true, email: true } } },
            });
            const plan = yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res));
            const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, ownerId(res), plan);
            yield (0, tagOwnership_1.prepareTags)(prisma);
            const activeTags = yield (0, planRestrictions_1.activeTagIds)(prisma, ownerId(res), plan);
            res.json(records.map((document) => {
                let fileSize = 0;
                try {
                    fileSize = fs_1.default.statSync(path_1.default.join(paths_1.uploadsDir, document.filePath)).size;
                }
                catch (_a) { }
                const { ocrText: _ocrText } = document, metadata = __rest(document, ["ocrText"]);
                return Object.assign(Object.assign({}, metadata), { fileSize, readOnly: active !== null && !active.has(document.id), tags: metadata.tags.map(entry => (Object.assign(Object.assign({}, entry), { tag: Object.assign(Object.assign({}, entry.tag), { inactive: activeTags !== null && !activeTags.has(entry.tagId) }) }))) });
            }));
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[GET /api/documents] Błąd pobierania:', details);
            res.status(500).json({ error: 'Błąd pobierania dokumentów', details });
        }
    }));
    router.get('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id < 1) {
                return res.status(400).json({ error: 'Nieprawidłowy identyfikator dokumentu.' });
            }
            const document = yield prisma.document.findUnique({
                where: { id },
                include: { tags: { include: { tag: true } }, user: { select: { name: true, email: true } } },
            });
            if (!document)
                return res.status(404).json({ error: 'Nie znaleziono dokumentu.' });
            let fileSize = 0;
            try {
                fileSize = fs_1.default.statSync(path_1.default.join(paths_1.uploadsDir, document.filePath)).size;
            }
            catch (_a) { }
            const { ocrText: _ocrText } = document, metadata = __rest(document, ["ocrText"]);
            const plan = yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res));
            const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, ownerId(res), plan);
            yield (0, tagOwnership_1.prepareTags)(prisma);
            const activeTags = yield (0, planRestrictions_1.activeTagIds)(prisma, ownerId(res), plan);
            return res.json(Object.assign(Object.assign({}, metadata), { fileSize, readOnly: active !== null && !active.has(document.id), tags: metadata.tags.map(entry => (Object.assign(Object.assign({}, entry), { tag: Object.assign(Object.assign({}, entry.tag), { inactive: activeTags !== null && !activeTags.has(entry.tagId) }) }))) }));
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error(`[GET /api/documents/${req.params.id}] Błąd pobierania:`, details);
            return res.status(500).json({ error: 'Błąd pobierania dokumentu', details });
        }
    }));
    router.patch('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const update = documentUpdate(req.body);
            if (!Number.isInteger(id) || id < 1 || !update)
                return res.status(400).json({ error: 'Nieprawidłowe dane aktualizacji dokumentu.' });
            const { tagIds } = update, data = __rest(update, ["tagIds"]);
            let destinationDigest;
            const onlyTrash = data.isDeleted === true && Object.keys(data).every(key => key === 'isDeleted' || key === 'deletedAt') && tagIds === undefined;
            const active = yield (0, planRestrictions_1.activeDocumentIds)(prisma, ownerId(res), yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
            if (!onlyTrash && active !== null && !active.has(id))
                return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Dokument przekracza limit planu. Możesz go otworzyć, pobrać albo usunąć. Aby go edytować, zwolnij miejsce lub wybierz wyższy plan.' });
            const current = res.locals.currentDocument;
            const restoring = ((current === null || current === void 0 ? void 0 : current.isDeleted) && data.isDeleted === false) || ((current === null || current === void 0 ? void 0 : current.isArchived) && data.isArchived === false);
            if (restoring && data.folderId === undefined)
                return res.status(400).json({ error: 'Wybierz podkartotekę, do której przywrócić dokument.' });
            if (data.folderId !== undefined) {
                const destinationId = Number(data.folderId);
                const destination = yield prisma.folder.findFirst({ where: { id: destinationId, ownerId: ownerId(res) }, select: { parentId: true } });
                if (!destination || !destination.parentId)
                    return res.status(400).json({ error: 'Wybierz własną podkartotekę docelową.' });
                data.folderId = destinationId;
                const original = res.locals.currentDocument;
                if (destinationId !== original.folderId || restoring)
                    destinationDigest = yield (0, duplicateDocuments_1.hashFile)(path_1.default.join(paths_1.uploadsDir, path_1.default.basename(original.filePath)));
            }
            if (data.isDeleted === true && data.deletedAt === undefined)
                data.deletedAt = new Date();
            if (data.isDeleted === false)
                data.deletedAt = null;
            let activeTags = null;
            if (Array.isArray(tagIds)) {
                yield (0, tagOwnership_1.prepareTags)(prisma);
                const allowedTags = new Set(yield (0, tagOwnership_1.tagIds)(prisma, ownerId(res)));
                activeTags = yield (0, planRestrictions_1.activeTagIds)(prisma, ownerId(res), yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
                if (tagIds.some((tagId) => !allowedTags.has(Number(tagId))))
                    return res.status(403).json({ error: 'Nie masz dostępu do wybranego tagu.' });
                if (activeTags && tagIds.some((tagId) => !activeTags.has(Number(tagId))))
                    return res.status(403).json({ code: 'PLAN_LIMIT_REACHED', error: 'Ten tag jest nieaktywny w obecnym planie.' });
            }
            const updated = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                if (destinationDigest)
                    yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId(res), Number(data.folderId), destinationDigest, id);
                if (Array.isArray(tagIds)) {
                    const old = yield tx.documentTag.findMany({ where: { documentId: id }, select: { tagId: true } });
                    const preserved = old.filter(entry => activeTags !== null && !activeTags.has(entry.tagId)).map(entry => entry.tagId);
                    const merged = [...new Set([...preserved, ...tagIds.map(Number)])];
                    yield tx.documentTag.deleteMany({ where: { documentId: id } });
                    if (merged.length)
                        yield tx.documentTag.createMany({ data: merged.map(tagId => ({ documentId: id, tagId })) });
                }
                return tx.document.update({ where: { id }, data, include: { tags: { include: { tag: true } } } });
            }));
            const { ocrText: _ocrText } = updated, metadata = __rest(updated, ["ocrText"]);
            res.json(metadata);
        }
        catch (error) {
            if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
            const details = (0, errors_1.errorMessage)(error);
            console.error(`[PATCH /api/documents/${req.params.id}] Błąd aktualizacji:`, details);
            res.status(500).json({ error: 'Błąd edycji dokumentu', details });
        }
    }));
    router.delete('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const result = yield removeTrashed(ownerId(res), Number(req.params.id));
            if (!result.deleted)
                return res.status(409).json({ error: 'Trwale usunąć można tylko dokument znajdujący się w koszu.' });
            res.json(Object.assign({ success: true }, result));
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error(`[DELETE /api/documents/${req.params.id}] Błąd usuwania:`, details);
            res.status(500).json({ error: 'Błąd usuwania dokumentu', details });
        }
    }));
    router.post('/upload-base64', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const { files, folderId, physicalLocation, retentions } = req.body;
            if (!Array.isArray(files) || files.length === 0)
                return res.status(400).json({ error: 'Nie wybrano żadnych plików.' });
            if (!Array.isArray(retentions))
                return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji.' });
            if (files.some((file) => {
                if (!file || typeof file !== 'object')
                    return true;
                const candidate = file;
                if (typeof candidate.name !== 'string' || !candidate.name.trim() || typeof candidate.data !== 'string')
                    return true;
                return !(0, base64DataUrl_1.parseBase64DataUrl)(candidate.data);
            }))
                return res.status(400).json({ error: 'Co najmniej jeden plik ma nieprawidłowy format.' });
            const targetFolder = yield prisma.folder.findFirst({ where: { id: Number(folderId), ownerId: ownerId(res) } });
            if (!targetFolder || !(yield (0, folders_1.isDocumentFolder)(prisma, folderId)))
                return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do własnej podkartoteki.' });
            const ownerKey = (0, ocrPremium_1.ocrOwnerKey)(res);
            const plan = yield (0, planLedger_1.getPlan)(prisma, ownerKey);
            if (((_a = req.body) === null || _a === void 0 ? void 0 : _a.isMerge) === true) {
                yield (0, planLedger_1.ensurePlanLedger)(prisma);
                const title = typeof req.body.mergedTitle === 'string' ? req.body.mergedTitle.trim() : '';
                if (!title || title.length > 255)
                    return res.status(400).json({ error: 'Podaj tytuł scalonego dokumentu.' });
                let merged;
                try {
                    merged = yield (0, mergeDocuments_1.mergeDocuments)(files);
                }
                catch (error) {
                    if (error instanceof mergeDocuments_1.UnsupportedMergeFormat)
                        return res.status(400).json({ error: error.message });
                    throw error;
                }
                const retention = req.body.mergedRetention || {};
                const value = Number(retention.value);
                if (!Number.isInteger(value) || value < 1 || !retentionUnits.has(retention.unit) || typeof retention.enabled !== 'boolean')
                    return res.status(400).json({ error: 'Nieprawidłowe ustawienia retencji.' });
                const filename = `${Date.now()}-${(0, crypto_1.randomUUID)()}.pdf`;
                const destination = path_1.default.join(paths_1.uploadsDir, filename);
                fs_1.default.writeFileSync(destination, merged, { flag: 'wx' });
                try {
                    const saved = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () { yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId(res), Number(folderId), (0, duplicateDocuments_1.hashBuffer)(merged)); yield (0, planLedger_1.checkDocumentCapacity)(tx, ownerId(res), plan, 1); yield (0, planLedger_1.consumeUsage)(tx, ownerKey, plan, 'merge', (0, crypto_1.randomUUID)(), 1); return tx.document.create({ data: { title, filePath: filename, mimeType: 'application/pdf', folderId: Number(folderId), physicalLocation: physicalLocation || null, retentionEnabled: retention.enabled, retentionValue: value, retentionUnit: retention.unit, userId: res.locals.userId || null } }); }));
                    void (0, ocrEnqueue_1.enqueuePremiumOcr)(prisma, ocrQueue, res, saved.id);
                    return res.json({ success: true, savedDocs: [saved] });
                }
                catch (error) {
                    fs_1.default.unlinkSync(destination);
                    throw error;
                }
            }
            const writtenFiles = [];
            const skippedDuplicates = [];
            let savedDocs;
            try {
                savedDocs = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                    const documents = [];
                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const retention = retentions[i] || {};
                        const retentionEnabled = retention.enabled !== false;
                        const retentionValue = Number(retention.value) || 5;
                        const retentionUnit = ['years', 'months', 'days', 'minutes'].includes(retention.unit) ? retention.unit : 'years';
                        const decoded = (0, base64DataUrl_1.parseBase64DataUrl)(file.data);
                        if (!decoded)
                            throw new Error('Nieprawidłowe dane pliku.');
                        const content = Buffer.from(decoded.base64, 'base64');
                        try {
                            yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId(res), Number(folderId), (0, duplicateDocuments_1.hashBuffer)(content));
                        }
                        catch (error) {
                            if (error instanceof duplicateDocuments_1.DuplicateDocumentError) {
                                skippedDuplicates.push({ name: file.name, existingTitle: error.existingTitle });
                                continue;
                            }
                            throw error;
                        }
                        yield (0, planLedger_1.checkDocumentCapacity)(tx, ownerId(res), plan, 1);
                        const extension = path_1.default.extname(file.name).toLowerCase();
                        const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
                        const filename = `${(0, crypto_1.randomUUID)()}${safeExtension}`;
                        const destination = path_1.default.join(paths_1.uploadsDir, filename);
                        fs_1.default.writeFileSync(destination, content, { flag: 'wx' });
                        writtenFiles.push(destination);
                        const saved = yield tx.document.create({ data: {
                                title: file.name, filePath: filename, mimeType: decoded.mimeType, folderId: Number(folderId),
                                physicalLocation: physicalLocation || null, retentionEnabled, retentionValue, retentionUnit,
                                thumbnail: file.thumbnail || null, userId: res.locals.userId || null,
                            } });
                        documents.push(saved);
                    }
                    return documents;
                }));
            }
            catch (error) {
                for (const destination of writtenFiles) {
                    try {
                        fs_1.default.unlinkSync(destination);
                    }
                    catch (cleanupError) {
                        console.error('[upload] Nie udało się usunąć pliku po błędzie zapisu:', (0, errors_1.errorMessage)(cleanupError));
                    }
                }
                throw error;
            }
            for (const saved of savedDocs)
                void (0, ocrEnqueue_1.enqueuePremiumOcr)(prisma, ocrQueue, res, saved.id);
            res.json({ success: true, savedDocs, skippedDuplicates });
        }
        catch (error) {
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
            if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
            const details = (0, errors_1.errorMessage)(error);
            console.error('[POST /api/documents/upload-base64] Błąd dekodowania:', details);
            res.status(500).json({ error: 'Błąd wgrywania Base64', details });
        }
    }));
    router.post('/export-pdf', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!(yield (0, premium_1.hasPremium)(prisma, res)))
                return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Eksport grupowy wymaga planu Premium.' });
            const ids = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.documentIds) ? req.body.documentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
            if (!ids.length || ids.length > 100)
                return res.status(400).json({ error: 'Wybierz od 1 do 100 dokumentów.' });
            const records = yield prisma.document.findMany({ where: { id: { in: ids }, folder: { ownerId: ownerId(res) } } });
            if (records.length !== ids.length)
                return res.status(403).json({ error: 'Nie masz dostępu do wszystkich wybranych dokumentów.' });
            const output = yield pdf_lib_1.PDFDocument.create();
            for (const record of records) {
                const file = fs_1.default.readFileSync(path_1.default.join(paths_1.uploadsDir, record.filePath));
                if (record.mimeType.includes('pdf') || record.filePath.toLowerCase().endsWith('.pdf')) {
                    const source = yield pdf_lib_1.PDFDocument.load(file);
                    const pages = yield output.copyPages(source, source.getPageIndices());
                    pages.forEach(page => output.addPage(page));
                }
                else if (record.mimeType.includes('png') || record.filePath.toLowerCase().endsWith('.png')) {
                    const image = yield output.embedPng(file);
                    const page = output.addPage([image.width, image.height]);
                    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                }
                else {
                    const image = yield output.embedJpg(file);
                    const page = output.addPage([image.width, image.height]);
                    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
                }
            }
            const bytes = yield output.save();
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="eteczka-eksport-${Date.now()}.pdf"`);
            res.send(Buffer.from(bytes));
        }
        catch (error) {
            res.status(500).json({ error: 'Nie udało się utworzyć połączonego PDF-a.', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    return router;
}
