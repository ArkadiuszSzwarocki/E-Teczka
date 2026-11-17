"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createArchiveWorkspaceRouter = createArchiveWorkspaceRouter;
const express_1 = __importDefault(require("express"));
const archiveWorkspace_1 = require("../services/archiveWorkspace");
function createArchiveWorkspaceRouter() {
    const router = express_1.default.Router();
    const ownerId = (res) => Number(res.locals.userId || 1);
    router.get('/', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json((0, archiveWorkspace_1.getArchiveWorkspace)(ownerId(res)));
    });
    router.put('/', (req, res) => {
        try {
            res.json((0, archiveWorkspace_1.saveArchiveWorkspace)(ownerId(res), req.body));
        }
        catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zapisać układu archiwum.' });
        }
    });
    return router;
}
