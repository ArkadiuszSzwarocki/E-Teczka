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
exports.createMobileScanRouter = createMobileScanRouter;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pdf_lib_1 = require("pdf-lib");
const paths_1 = require("../config/paths");
const folders_1 = require("../services/folders");
const errors_1 = require("../utils/errors");
// @ts-ignore - multer is used without bundled TypeScript declarations.
const multer_1 = __importDefault(require("multer"));
const RETENTION_UNITS = ['years', 'months', 'days', 'minutes'];
const validDraftId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const getDraftDir = (draftId) => path_1.default.join(paths_1.scanDraftsDir, draftId);
/** Phone scan upload, temporary pages and PDF finalization. */
function createMobileScanRouter(prisma) {
    const router = express_1.default.Router();
    const upload = (0, multer_1.default)({
        storage: multer_1.default.diskStorage({
            destination: (_req, _file, cb) => cb(null, paths_1.uploadsDir),
            filename: (_req, _file, cb) => cb(null, 'SCAN_' + Date.now() + '.jpg'),
        }),
        limits: { files: 50, fileSize: 50 * 1024 * 1024 },
    });
    router.post('/mobile-scan', upload.single('file'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            if (!req.file || !req.body.folderId)
                return res.status(400).json({ error: 'Brak pliku lub folderId' });
            if (!(yield (0, folders_1.isDocumentFolder)(prisma, req.body.folderId)))
                return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do podkartotek.' });
            const retentionValue = Number(req.body.retentionValue);
            const retentionUnit = String(req.body.retentionUnit || 'years');
            if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
                if (fs_1.default.existsSync(req.file.path))
                    fs_1.default.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
            }
            const document = yield prisma.document.create({ data: {
                    title: String(req.body.title).slice(0, 255), filePath: req.file.filename, folderId: Number(req.body.folderId), mimeType: 'image/jpeg',
                    retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
                } });
            res.status(200).json(document);
        }
        catch (error) {
            const details = (0, errors_1.errorMessage)(error);
            console.error('[/api/mobile-scan] BŁĄD:', details);
            res.status(500).json({ error: 'Błąd bazy danych podczas zapisu skanu', details });
        }
    }));
    router.post('/mobile-scan-document', upload.array('files', 50), (req, res) => __awaiter(this, void 0, void 0, function* () {
        const files = Array.isArray(req.files) ? req.files : [];
        const removeTemporaryFiles = () => files.forEach((file) => { if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path); });
        try {
            if (!files.length || !req.body.folderId)
                return res.status(400).json({ error: 'Dodaj co najmniej jedną stronę i wybierz kartotekę.' });
            if (!(yield (0, folders_1.isDocumentFolder)(prisma, req.body.folderId)))
                return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do podkartotek.' });
            const retentionValue = Number(req.body.retentionValue);
            const retentionUnit = String(req.body.retentionUnit || 'years');
            if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
                removeTemporaryFiles();
                return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
            }
            const pdf = yield pdf_lib_1.PDFDocument.create();
            for (const file of files) {
                const bytes = fs_1.default.readFileSync(file.path);
                const image = file.mimetype === 'image/png' ? yield pdf.embedPng(bytes) : yield pdf.embedJpg(bytes);
                const page = pdf.addPage([image.width, image.height]);
                page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
            }
            const filename = 'SCAN_DOCUMENT_' + Date.now() + '.pdf';
            fs_1.default.writeFileSync(path_1.default.join(paths_1.uploadsDir, filename), yield pdf.save());
            removeTemporaryFiles();
            res.status(201).json(yield prisma.document.create({ data: {
                    title: String(req.body.title).slice(0, 255), filePath: filename, folderId: Number(req.body.folderId), mimeType: 'application/pdf',
                    retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
                } }));
        }
        catch (error) {
            removeTemporaryFiles();
            console.error('[/api/mobile-scan-document] BŁĄD:', (0, errors_1.errorMessage)(error));
            res.status(500).json({ error: 'Nie udało się scalić dokumentu do PDF.' });
        }
    }));
    router.post('/mobile-scan-draft/page', upload.single('file'), (req, res) => {
        var _a, _b;
        const draftId = (_a = req.body) === null || _a === void 0 ? void 0 : _a.draftId;
        const pageNumber = Number((_b = req.body) === null || _b === void 0 ? void 0 : _b.pageNumber);
        const removeIncomingFile = () => { var _a; if (((_a = req.file) === null || _a === void 0 ? void 0 : _a.path) && fs_1.default.existsSync(req.file.path))
            fs_1.default.unlinkSync(req.file.path); };
        try {
            if (!req.file || !validDraftId(draftId) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 50) {
                removeIncomingFile();
                return res.status(400).json({ error: 'Nieprawidłowa strona wersji roboczej.' });
            }
            const draftDir = getDraftDir(draftId);
            fs_1.default.mkdirSync(draftDir, { recursive: true });
            const destination = path_1.default.join(draftDir, 'page-' + String(pageNumber).padStart(3, '0') + '.jpg');
            if (fs_1.default.existsSync(destination))
                fs_1.default.unlinkSync(destination);
            fs_1.default.renameSync(req.file.path, destination);
            res.status(201).json({ pageNumber });
        }
        catch (error) {
            removeIncomingFile();
            console.error('[/api/mobile-scan-draft/page] BŁĄD:', (0, errors_1.errorMessage)(error));
            res.status(500).json({ error: 'Nie udało się odebrać strony skanu.' });
        }
    });
    router.post('/mobile-scan-draft/finalize', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const { draftId, folderId, title, retentionValue: rawRetentionValue, retentionUnit = 'years', retentionEnabled = false, thumbnail } = req.body || {};
        try {
            const retentionValue = Number(rawRetentionValue);
            if (!validDraftId(draftId) || !folderId || !title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(String(retentionUnit))) {
                return res.status(400).json({ error: 'Nieprawidłowe dane dokumentu.' });
            }
            if (!(yield (0, folders_1.isDocumentFolder)(prisma, folderId)))
                return res.status(400).json({ error: 'Dokumenty można dodawać wyłącznie do podkartotek.' });
            const draftDir = getDraftDir(draftId);
            if (!fs_1.default.existsSync(draftDir))
                return res.status(400).json({ error: 'Nie znaleziono wersji roboczej na komputerze.' });
            const pagePaths = fs_1.default.readdirSync(draftDir).filter((name) => /^page-\d{3}\.jpg$/.test(name)).sort().map((name) => path_1.default.join(draftDir, name));
            if (!pagePaths.length)
                return res.status(400).json({ error: 'Wersja robocza nie zawiera stron.' });
            const pdf = yield pdf_lib_1.PDFDocument.create();
            for (const pagePath of pagePaths) {
                const image = yield pdf.embedJpg(fs_1.default.readFileSync(pagePath));
                const page = pdf.addPage([image.width, image.height]);
                page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
            }
            const filename = 'SCAN_DOCUMENT_' + Date.now() + '.pdf';
            fs_1.default.writeFileSync(path_1.default.join(paths_1.uploadsDir, filename), yield pdf.save());
            const document = yield prisma.document.create({ data: {
                    title: String(title).slice(0, 255), filePath: filename, folderId: Number(folderId), mimeType: 'application/pdf',
                    retentionEnabled: Boolean(retentionEnabled), retentionValue, retentionUnit: String(retentionUnit),
                    thumbnail: typeof thumbnail === 'string' && /^data:image\/jpeg;base64,/.test(thumbnail) && thumbnail.length <= 300000 ? thumbnail : null,
                } });
            fs_1.default.rmSync(draftDir, { recursive: true, force: true });
            res.status(201).json(document);
        }
        catch (error) {
            console.error('[/api/mobile-scan-draft/finalize] BŁĄD:', (0, errors_1.errorMessage)(error));
            res.status(500).json({ error: 'Nie udało się scalić dokumentu do PDF.' });
        }
    }));
    return router;
}
