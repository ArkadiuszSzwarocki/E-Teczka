"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.createBackupRouter = createBackupRouter;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver = __importStar(require("archiver"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const multer_1 = __importDefault(require("multer"));
const paths_1 = require("../config/paths");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res) => Number(res.locals.userId || 1);
function createBackupRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/export', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const currentOwner = ownerId(res);
        const folders = yield prisma.folder.findMany({ where: { ownerId: currentOwner }, orderBy: { id: 'asc' } });
        const documents = yield prisma.document.findMany({ where: { folder: { ownerId: currentOwner } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
        const manifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            folders,
            documents: documents.map((_a) => {
                var { tags } = _a, document = __rest(_a, ["tags"]);
                return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
            }),
        };
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (error) => { if (!res.headersSent)
            res.status(500); res.end(); console.error('[backup] export:', error); });
        archive.pipe(res);
        archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
        for (const document of documents) {
            const source = path_1.default.join(paths_1.uploadsDir, document.filePath);
            if (fs_1.default.existsSync(source))
                archive.file(source, { name: `files/${document.id}-${path_1.default.basename(document.filePath)}` });
        }
        yield archive.finalize();
    }));
    router.post('/restore', upload.single('backup'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!req.file)
            return res.status(400).json({ error: 'Wybierz plik kopii zapasowej.' });
        try {
            const zip = new adm_zip_1.default(req.file.buffer);
            const manifestEntry = zip.getEntry('manifest.json');
            if (!manifestEntry)
                return res.status(400).json({ error: 'Nieprawidłowa kopia: brak manifestu.' });
            const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
            if (manifest.version !== 1 || !Array.isArray(manifest.folders) || !Array.isArray(manifest.documents))
                return res.status(400).json({ error: 'Nieobsługiwana wersja kopii zapasowej.' });
            const currentOwner = ownerId(res);
            const folderMap = new Map();
            yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const pending = [...manifest.folders];
                while (pending.length) {
                    const index = pending.findIndex(folder => !folder.parentId || folderMap.has(Number(folder.parentId)));
                    if (index < 0)
                        throw new Error('Nieprawidłowa hierarchia kartotek.');
                    const source = pending.splice(index, 1)[0];
                    const created = yield tx.folder.create({ data: { name: String(source.name || 'Przywrócona kartoteka').slice(0, 255), parentId: source.parentId ? folderMap.get(Number(source.parentId)) || null : null, ownerId: currentOwner, order: Number(source.order) || 0 } });
                    folderMap.set(Number(source.id), created.id);
                }
                for (const source of manifest.documents) {
                    const folderId = folderMap.get(Number(source.folderId));
                    if (!folderId)
                        continue;
                    const entryName = `files/${source.id}-${path_1.default.basename(String(source.filePath || ''))}`;
                    const entry = zip.getEntry(entryName);
                    if (!entry)
                        continue;
                    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${path_1.default.basename(String(source.filePath))}`;
                    fs_1.default.writeFileSync(path_1.default.join(paths_1.uploadsDir, safeName), entry.getData());
                    const created = yield tx.document.create({ data: { title: String(source.title || 'Przywrócony dokument').slice(0, 255), filePath: safeName, mimeType: String(source.mimeType || 'application/octet-stream'), folderId, userId: res.locals.userId ? currentOwner : null, retentionEnabled: source.retentionEnabled !== false, retentionValue: Number(source.retentionValue) || 5, retentionUnit: String(source.retentionUnit || 'years'), isArchived: Boolean(source.isArchived), isDeleted: false, ocrText: typeof source.ocrText === 'string' ? source.ocrText.slice(0, 100000) : null } });
                    for (const tag of source.tags || []) {
                        const tagRecord = yield tx.tag.upsert({ where: { name: String(tag.name || '').slice(0, 80) }, create: { name: String(tag.name || 'tag').slice(0, 80), color: String(tag.color || '#2563eb') }, update: {} });
                        yield tx.documentTag.create({ data: { documentId: created.id, tagId: tagRecord.id } }).catch(() => undefined);
                    }
                }
            }));
            res.json({ success: true, restoredFolders: manifest.folders.length, restoredDocuments: manifest.documents.length });
        }
        catch (error) {
            console.error('[backup] restore:', error);
            res.status(400).json({ error: 'Nie udało się przywrócić kopii zapasowej.' });
        }
    }));
    return router;
}
