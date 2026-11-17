"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLegalRouter = createLegalRouter;
const express_1 = __importDefault(require("express"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const DOCS = [
    { id: 'privacy', title: 'Polityka prywatności', filename: 'POLITYKA-PRYWATNOSCI.md' },
    { id: 'terms', title: 'Regulamin aplikacji', filename: 'REGULAMIN-APLIKACJI.md' },
    { id: 'consents', title: 'Zgody użytkownika', filename: 'ZGODY-UZYTKOWNIKA.md' },
    { id: 'storage', title: 'Bazy i przechowywanie danych', filename: 'ARCHITEKTURA-DANYCH-I-BAZY.md' },
];
function resolveDocsDir() {
    var _a;
    const candidates = [
        node_path_1.default.resolve(__dirname, '../../docs'),
        node_path_1.default.resolve(__dirname, '../docs'),
        node_path_1.default.resolve(process.cwd(), '../docs'),
        node_path_1.default.resolve(process.cwd(), 'docs'),
    ];
    return (_a = candidates.find(dir => node_fs_1.default.existsSync(dir))) !== null && _a !== void 0 ? _a : candidates[0];
}
/** Public endpoint serving legal & architecture documents from /docs. */
function createLegalRouter() {
    const router = express_1.default.Router();
    router.get('/', (_req, res) => {
        const docsDir = resolveDocsDir();
        const items = DOCS.map(doc => {
            const filePath = node_path_1.default.join(docsDir, doc.filename);
            let content = 'Dokument nie jest obecnie dostępny.';
            try {
                if (node_fs_1.default.existsSync(filePath))
                    content = node_fs_1.default.readFileSync(filePath, 'utf8');
            }
            catch ( /* keep fallback */_a) { /* keep fallback */ }
            return { id: doc.id, title: doc.title, content };
        });
        res.json({ documents: items });
    });
    return router;
}
