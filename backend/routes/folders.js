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
const errors_1 = require("../utils/errors");
function createFolderRouter(prisma) {
    const router = express_1.default.Router();
    const ownerId = (res) => Number(res.locals.userId || 1);
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            res.json(yield prisma.folder.findMany({ where: { ownerId: ownerId(res) }, orderBy: { order: 'asc' }, include: { _count: { select: { documents: { where: { isArchived: false, isDeleted: false } } } } } }));
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
            const count = yield prisma.folder.count({ where: { parentId: parentId ? Number(parentId) : null, ownerId: currentOwner } });
            res.json(yield prisma.folder.create({ data: { name, parentId: parentId ? Number(parentId) : null, order: count, ownerId: currentOwner } }));
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[POST /api/folders] Błąd tworzenia:', details);
            res.status(500).json({ error: 'Błąd tworzenia kartoteki', details });
        }
    }));
    router.use('/:id', (req, res, next) => __awaiter(this, void 0, void 0, function* () {
        const folder = yield prisma.folder.findFirst({ where: { id: Number(req.params.id), ownerId: ownerId(res) } });
        if (!folder)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        next();
    }));
    router.patch('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const { name } = req.body;
            if (name)
                return res.json(yield prisma.folder.update({ where: { id: Number(req.params.id) }, data: { name } }));
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
        var _a;
        try {
            const currentOwner = ownerId(res);
            const sourceId = Number(req.params.id);
            const transferFolderId = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.transferFolderId) ? Number(req.body.transferFolderId) : null;
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
                if (targetId && (documentCount || archivedCount || trashedCount))
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
