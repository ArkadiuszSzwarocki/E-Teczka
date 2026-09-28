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
            const ids = yield (0, folders_1.collectFolderBranch)(prisma, Number(req.params.id));
            res.json({ folderIds: ids, documentCount: yield prisma.document.count({ where: { folderId: { in: ids } } }) });
        }
        catch (error) {
            res.status(500).json({ error: 'Nie udało się sprawdzić zawartości kartoteki.', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.post('/:id/delete-safely', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const ids = yield (0, folders_1.collectFolderBranch)(prisma, Number(req.params.id));
            const documentCount = yield prisma.document.count({ where: { folderId: { in: ids } } });
            const transferFolderId = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.transferFolderId) ? Number(req.body.transferFolderId) : null;
            if (documentCount && (!transferFolderId || ids.includes(transferFolderId)))
                return res.status(400).json({ error: 'Wybierz inną kartotekę docelową dla dokumentów.' });
            if (transferFolderId) {
                const target = yield prisma.folder.findUnique({ where: { id: transferFolderId }, select: { parentId: true } });
                if (!target)
                    return res.status(400).json({ error: 'Wybrana kartoteka docelowa nie istnieje.' });
                if (!target.parentId)
                    return res.status(400).json({ error: 'Dokumenty można przenieść wyłącznie do podkartoteki.' });
            }
            yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () { if (documentCount && transferFolderId)
                yield tx.document.updateMany({ where: { folderId: { in: ids } }, data: { folderId: transferFolderId } }); for (const folderId of [...ids].reverse())
                yield tx.folder.delete({ where: { id: folderId } }); }));
            res.json({ success: true, movedDocuments: documentCount });
        }
        catch (error) {
            res.status(500).json({ error: 'Błąd usuwania kartoteki', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    return router;
}
