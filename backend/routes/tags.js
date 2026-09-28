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
const errors_1 = require("../utils/errors");
const premium_1 = require("../middleware/premium");
/** Tag catalog routes. Document-tag assignments remain in the document routes. */
function createTagRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            res.json(yield prisma.tag.findMany({ orderBy: { name: 'asc' } }));
        }
        catch (error) {
            res.status(500).json({ error: 'Błąd pobierania tagów', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.post('/', (0, premium_1.requirePremium)(prisma), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const name = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.name) || '').trim();
            const color = String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.color) || '#2563eb');
            if (!name)
                return res.status(400).json({ error: 'Podaj nazwę tagu.' });
            res.status(201).json(yield prisma.tag.create({ data: { name, color } }));
        }
        catch (error) {
            const duplicate = (0, errors_1.hasErrorCode)(error, 'P2002');
            res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Taki tag już istnieje.' : 'Błąd tworzenia tagu', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    router.delete('/:id', (0, premium_1.requirePremium)(prisma), (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield prisma.tag.delete({ where: { id: Number(req.params.id) } });
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ error: 'Błąd usuwania tagu', details: (0, errors_1.errorMessage)(error) });
        }
    }));
    return router;
}
