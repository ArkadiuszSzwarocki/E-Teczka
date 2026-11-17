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
exports.createTagRouter = createTagRouter;
const express_1 = __importDefault(require("express"));
const tagOwnership_1 = require("../services/tagOwnership");
const errors_1 = require("../utils/errors");
const planLedger_1 = require("../services/planLedger");
const centralPlanLedger_1 = require("../services/centralPlanLedger");
const ocrPremium_1 = require("../services/ocrPremium");
const planRestrictions_1 = require("../services/planRestrictions");
function createTagRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, tagOwnership_1.prepareTags)(prisma);
            const owner = Number(res.locals.userId || 1);
            const ids = yield (0, tagOwnership_1.tagIds)(prisma, owner);
            const active = yield (0, planRestrictions_1.activeTagIds)(prisma, owner, yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)));
            const tags = yield prisma.tag.findMany({ where: { id: { in: ids } }, orderBy: { name: 'asc' } });
            res.json(tags.map(tag => (Object.assign(Object.assign({}, tag), { inactive: active !== null && !active.has(tag.id) }))));
        }
        catch (error) {
            res.status(500).json({ error: 'Błąd pobierania tagów', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const name = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.name) || '').trim();
            const color = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.color) || '#2563eb');
            if (!name)
                return res.status(400).json({ error: 'Podaj nazwę tagu.' });
            const ownerId = Number(res.locals.userId || 1);
            const plan = yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res));
            yield (0, tagOwnership_1.prepareTags)(prisma);
            const tag = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const ids = yield (0, tagOwnership_1.tagIds)(tx, ownerId);
                const existing = yield tx.tag.findUnique({ where: { name } });
                if (existing && ids.includes(existing.id))
                    throw new Error('Taki tag już istnieje.');
                yield (0, planLedger_1.checkTagCapacity)(tx, ownerId, plan, ids.length);
                const result = existing || (yield tx.tag.create({ data: { name, color } }));
                yield tx.$executeRaw `INSERT INTO PlanTagOwner(ownerId, tagId) VALUES (${ownerId}, ${result.id})`;
                return result;
            }));
            res.status(201).json(tag);
        }
        catch (error) {
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message });
            const duplicate = (0, errors_1.hasErrorCode)(error, 'P2002') || (0, errors_1.errorMessage)(error) === 'Taki tag już istnieje.';
            res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Taki tag już istnieje.' : 'Błąd tworzenia tagu', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.delete('/:id', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const id = Number(req.params.id);
            const ownerId = Number(res.locals.userId || 1);
            if (!Number.isSafeInteger(id) || id < 1)
                return res.status(400).json({ error: 'Nieprawidłowy tag.' });
            yield (0, tagOwnership_1.prepareTags)(prisma);
            const removed = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                (0, centralPlanLedger_1.markCentralInventoryDirty)();
                const deleted = yield tx.$executeRaw `DELETE FROM PlanTagOwner WHERE ownerId = ${ownerId} AND tagId = ${id}`;
                if (!deleted)
                    return false;
                const ownedDocs = yield tx.document.findMany({ where: { folder: { ownerId } }, select: { id: true } });
                yield tx.documentTag.deleteMany({ where: { tagId: id, documentId: { in: ownedDocs.map(doc => doc.id) } } });
                const owners = yield tx.$queryRaw `SELECT COUNT(*) AS count FROM PlanTagOwner WHERE tagId = ${id}`;
                if (Number(owners[0].count) === 0)
                    yield tx.tag.delete({ where: { id } });
                return true;
            }));
            if (!removed)
                return res.status(404).json({ error: 'Nie znaleziono tagu.' });
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: 'Błąd usuwania tagu', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    return router;
}
