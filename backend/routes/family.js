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
exports.createFamilyRouter = createFamilyRouter;
const express_1 = __importDefault(require("express"));
const familyGroup_1 = require("../services/familyGroup");
/** REST endpoints for Family plan invitations, membership, and shared workspace status. */
function createFamilyRouter(prisma) {
    const router = express_1.default.Router();
    const userId = (res) => Number(res.locals.userId || 1);
    const handleError = (res, error, fallback) => {
        if (error instanceof familyGroup_1.FamilyError)
            return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: fallback });
    };
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            res.json(yield (0, familyGroup_1.getFamilyOverview)(prisma, userId(res)));
        }
        catch (error) {
            handleError(res, error, 'Nie udało się pobrać informacji o grupie rodzinnej.');
        }
    }));
    router.post('/invite', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const invite = yield (0, familyGroup_1.createFamilyInvite)(prisma, userId(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.email) || ''));
            res.status(201).json(invite);
        }
        catch (error) {
            handleError(res, error, 'Nie udało się wysłać zaproszenia.');
        }
    }));
    router.post('/accept', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            yield (0, familyGroup_1.acceptFamilyInvite)(prisma, userId(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.code) || ''));
            res.json(yield (0, familyGroup_1.getFamilyOverview)(prisma, userId(res)));
        }
        catch (error) {
            handleError(res, error, 'Nie udało się zaakceptować zaproszenia.');
        }
    }));
    router.delete('/invites/:inviteId', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, familyGroup_1.cancelFamilyInvite)(prisma, userId(res), Number(req.params.inviteId));
            res.status(204).end();
        }
        catch (error) {
            handleError(res, error, 'Nie udało się anulować zaproszenia.');
        }
    }));
    router.delete('/members/:memberUserId', (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield (0, familyGroup_1.removeFamilyMember)(prisma, userId(res), Number(req.params.memberUserId));
            res.status(204).end();
        }
        catch (error) {
            handleError(res, error, 'Nie udało się zaktualizować składu rodziny.');
        }
    }));
    return router;
}
