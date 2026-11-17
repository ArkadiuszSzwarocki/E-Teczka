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
exports.createFolderRouter = createFolderRouter;
const express_1 = __importDefault(require("express"));
const folders_1 = require("../services/folders");
const familyAccess_1 = require("../services/familyAccess");
const errors_1 = require("../utils/errors");
function createFolderRouter(prisma) {
    const router = express_1.default.Router();
    const ownerId = (res) => Number(res.locals.userId || 1);
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const accessibleIds = yield (0, familyAccess_1.getAccessibleFolderIds)(prisma, ownerId(res));
            res.json(yield prisma.folder.findMany({ where: { id: { in: accessibleIds } }, orderBy: { order: 'asc' }, include: { _count: { select: { documents: { where: { isArchived: false, isDeleted: false } } } } } }));
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[GET /api/folders] Błąd bazy:', details);
            res.status(500).json({ error: 'Błąd pobierania kartotek', details });
        }
    }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const { name, parentId } = req.body;
            const currentOwner = ownerId(res);
            const parsedParent = parentId ? Number(parentId) : null;
            if (parsedParent !== null && !(yield (0, familyAccess_1.canAccessFolder)(prisma, currentOwner, parsedParent))) {
                return res.status(403).json({ error: 'Brak dostępu do kartoteki nadrzędnej.' });
            }
            const count = yield prisma.folder.count({ where: { parentId: parsedParent, ownerId: currentOwner } });
            res.json(yield prisma.folder.create({ data: { name, parentId: parsedParent, order: count, ownerId: currentOwner } }));
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[POST /api/folders] Błąd tworzenia:', details);
            res.status(500).json({ error: 'Błąd tworzenia kartoteki', details });
        }
    }));
    router.post('/reorder', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const ids = Array.isArray((_a = req.body) === null || _a === void 0 ? void 0 : _a.orderedIds) ? req.body.orderedIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
            if (!ids.length)
                return res.status(400).json({ error: 'Brak listy kartotek.' });
            const accessible = new Set(yield (0, familyAccess_1.getAccessibleFolderIds)(prisma, ownerId(res)));
            const allowedIds = ids.filter((id) => accessible.has(id));
            yield prisma.$transaction(allowedIds.map((id, idx) => prisma.folder.updateMany({ where: { id }, data: { order: idx } })));
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: 'Błąd zapisu kolejności kartotek.', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.use('/:id', (req, res, next) => __awaiter(this, void 0, void 0, function* () {
        const id = Number(req.params.id);
        if (!(yield (0, familyAccess_1.canAccessFolder)(prisma, ownerId(res), id)))
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        next();
    }));
    router.patch('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const { name, parentId } = req.body || {};
            const data = {};
            if (typeof name === 'string' && name.trim())
                data.name = name.trim();
            if (parentId !== undefined) {
                if (parentId === null)
                    data.parentId = null;
                else {
                    const targetParent = Number(parentId);
                    const branch = yield (0, folders_1.collectFolderBranch)(prisma, Number(req.params.id), ownerId(res));
                    if (!Number.isInteger(targetParent) || branch.includes(targetParent))
                        return res.status(400).json({ error: 'Nie można przenieść kartoteki do samej siebie ani podkartoteki.' });
                    const owned = yield prisma.folder.findFirst({ where: { id: targetParent, ownerId: ownerId(res) }, select: { id: true } });
                    if (!owned)
                        return res.status(404).json({ error: 'Nie znaleziono kartoteki docelowej.' });
                    data.parentId = targetParent;
                }
            }
            if (Object.keys(data).length)
                return res.json(yield prisma.folder.update({ where: { id: Number(req.params.id) }, data }));
            res.json({ success: true });
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error(`[PATCH /api/folders/${req.params.id}] Błąd edycji:`, details);
            res.status(500).json({ error: 'Błąd edycji kartoteki', details });
        }
    }));
    router.patch('/:id/move', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const target = yield prisma.folder.findUnique({ where: { id: Number(req.params.id) } });
            if (!target)
                return res.status(404).json({ error: 'Brak folderu' });
            const siblings = yield prisma.folder.findMany({ where: { parentId: target.parentId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
            siblings.forEach((folder, index) => { folder.order = index; });
            const index = siblings.findIndex(folder => folder.id === target.id);
            if (req.body.direction === 'up' && index > 0)
                [siblings[index].order, siblings[index - 1].order] = [siblings[index - 1].order, siblings[index].order];
            if (req.body.direction === 'down' && index < siblings.length - 1)
                [siblings[index].order, siblings[index + 1].order] = [siblings[index + 1].order, siblings[index].order];
            yield prisma.$transaction(siblings.map(folder => prisma.folder.update({ where: { id: folder.id }, data: { order: folder.order } })));
            res.json({ success: true });
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error(`[PATCH /api/folders/${req.params.id}/move] Błąd sortowania:`, details);
            res.status(500).json({ error: 'Błąd sortowania', details });
        }
    }));
    router.get('/:id/delete-preview', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const ids = yield (0, folders_1.collectFolderBranch)(prisma, Number(req.params.id), ownerId(res));
            const [documentCount, archivedCount, trashedCount] = yield Promise.all([
                prisma.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: false } }),
                prisma.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: true } }),
                prisma.document.count({ where: { folderId: { in: ids }, isDeleted: true } }),
            ]);
            res.json({ folderIds: ids, documentCount, archivedCount, trashedCount });
        }
        catch (error) {
            res.status(500).json({ error: 'Nie udało się sprawdzić zawartości kartoteki.', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.post('/:id/delete-safely', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const currentOwner = ownerId(res);
            const sourceId = Number(req.params.id);
            const transferFolderId = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.transferFolderId) ? Number(req.body.transferFolderId) : null;
            const mode = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.mode) === 'trash' ? 'trash' : 'transfer';
            const result = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const source = yield tx.folder.findFirst({ where: { id: sourceId, ownerId: currentOwner }, select: { id: true } });
                if (!source)
                    throw new Error('Kartoteka już nie istnieje.');
                const ids = yield (0, folders_1.collectFolderBranch)(tx, sourceId, currentOwner);
                const foreignChildren = yield tx.folder.count({ where: { parentId: { in: ids }, ownerId: { not: currentOwner } } });
                if (foreignChildren)
                    throw new Error('Kartoteka zawiera podkartoteki innego użytkownika.');
                const [documentCount, archivedCount, trashedCount] = yield Promise.all([
                    tx.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: false } }),
                    tx.document.count({ where: { folderId: { in: ids }, isDeleted: false, isArchived: true } }),
                    tx.document.count({ where: { folderId: { in: ids }, isDeleted: true } }),
                ]);
                const totalDocs = documentCount + archivedCount + trashedCount;
                if (mode === 'trash') {
                    if (totalDocs > 0) {
                        const fallback = yield tx.folder.findFirst({ where: { ownerId: currentOwner, id: { notIn: ids } }, orderBy: [{ parentId: 'desc' }, { id: 'asc' }], select: { id: true } });
                        if (!fallback)
                            throw new Error('Aby przenieść dokumenty do kosza i usunąć tę kartotekę, pozostaw w systemie przynajmniej jedną inną kartotekę.');
                        yield tx.document.updateMany({ where: { folderId: { in: ids } }, data: { isDeleted: true, isArchived: false, deletedAt: new Date(), folderId: fallback.id } });
                    }
                    for (const folderId of [...ids].reverse())
                        yield tx.folder.delete({ where: { id: folderId } });
                    return { success: true, movedDocuments: 0, trashedDocuments: documentCount + archivedCount, preservedArchived: 0, preservedTrash: trashedCount, targetFolderId: null };
                }
                if (documentCount && (!transferFolderId || ids.includes(transferFolderId)))
                    throw new Error('Wybierz inną podkartotekę docelową dla aktywnych dokumentów.');
                let targetId = transferFolderId;
                if (targetId) {
                    const target = yield tx.folder.findFirst({ where: { id: targetId, ownerId: currentOwner }, select: { id: true, parentId: true } });
                    if (!target || ids.includes(targetId) || !target.parentId)
                        throw new Error('Wybierz istniejącą podkartotekę docelową poza usuwaną kartoteką.');
                }
                else if (archivedCount || trashedCount) {
                    throw new Error('Wybierz podkartotekę, aby zachować dokumenty z archiwum i kosza.');
                }
                if (targetId && totalDocs)
                    yield tx.document.updateMany({ where: { folderId: { in: ids } }, data: { folderId: targetId } });
                for (const folderId of [...ids].reverse())
                    yield tx.folder.delete({ where: { id: folderId } });
                return { success: true, movedDocuments: documentCount, preservedArchived: archivedCount, preservedTrash: trashedCount, targetFolderId: targetId };
            }));
            res.json(result);
        }
        catch (error) {
            res.status(409).json({ error: (0, errors_1.errorMessage)(error) || 'Błąd usuwania kartoteki.' });
        }
    }));
    return router;
}
