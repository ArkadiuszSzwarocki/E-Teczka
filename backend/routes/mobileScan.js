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
const errors_1 = require("../utils/errors");
const ocrEnqueue_1 = require("../services/ocrEnqueue");
const ocrPremium_1 = require("../services/ocrPremium");
const planLedger_1 = require("../services/planLedger");
const node_crypto_1 = require("node:crypto");
const duplicateDocuments_1 = require("../services/duplicateDocuments");
// @ts-ignore - multer is used without bundled TypeScript declarations.
const multer_1 = __importDefault(require("multer"));
const RETENTION_UNITS = ['years', 'months', 'days', 'minutes'];
const validDraftId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const getDraftDir = (draftId) => path_1.default.join(paths_1.scanDraftsDir, draftId);
/** Phone scan upload, temporary pages and PDF finalization. */
function createMobileScanRouter(prisma, ocrQueue) {
    const router = express_1.default.Router();
    const upload = (0, multer_1.default)({
        storage: multer_1.default.diskStorage({
            destination: (_req, _file, cb) => cb(null, paths_1.uploadsDir),
            filename: (_req, _file, cb) => cb(null, 'SCAN_' + (0, node_crypto_1.randomUUID)() + '.jpg'),
        }),
        limits: { files: 50, fileSize: 50 * 1024 * 1024 },
    });
    router.post('/mobile-scan', upload.single('file'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!req.file || !req.body.folderId)
                return res.status(400).json({ error: 'Brak pliku lub folderId' });
            if (!(yield prisma.folder.findFirst({ where: { id: Number(req.body.folderId), ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })))
                return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
            const retentionValue = Number(req.body.retentionValue);
            const retentionUnit = String(req.body.retentionUnit || 'years');
            if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
                if (fs_1.default.existsSync(req.file.path))
                    fs_1.default.unlinkSync(req.file.path);
                return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
            }
            const uploadedFile = req.file;
            const key = (0, ocrPremium_1.ocrOwnerKey)(res);
            const plan = yield (0, planLedger_1.getPlan)(prisma, key);
            yield (0, planLedger_1.ensurePlanLedger)(prisma);
            const digest = yield (0, duplicateDocuments_1.hashFile)(uploadedFile.path);
            const document = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, Number(res.locals.userId || 1), Number(req.body.folderId), digest);
                yield (0, planLedger_1.checkDocumentCapacity)(tx, Number(res.locals.userId || 1), plan, 1);
                yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'cameraScan', (0, node_crypto_1.randomUUID)(), 1);
                return tx.document.create({ data: {
                        title: String(req.body.title).slice(0, 255), filePath: uploadedFile.filename, folderId: Number(req.body.folderId), mimeType: 'image/jpeg',
                        retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
                    } });
            }));
            void (0, ocrEnqueue_1.enqueuePremiumOcr)(prisma, ocrQueue, res, document.id);
            res.status(200).json(document);
        }
        catch (error) {
            if (((_a = req.file) === null || _a === void 0 ? void 0 : _a.path) && fs_1.default.existsSync(req.file.path))
                fs_1.default.unlinkSync(req.file.path);
            if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
            const details = (0, errors_1.errorMessage)(error);
            console.error('[/api/mobile-scan] BŁĄD:', details);
            res.status(500).json({ error: 'Błąd bazy danych podczas zapisu skanu', details });
        }
    }));
    router.post('/mobile-scan-document', upload.array('files', 50), (req, res) => __awaiter(this, void 0, void 0, function* () {
        const files = Array.isArray(req.files) ? req.files : [];
        const removeTemporaryFiles = () => files.forEach((file) => { if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path); });
        let outputPath = '';
        try {
            if (!files.length || !req.body.folderId)
                return res.status(400).json({ error: 'Dodaj co najmniej jedną stronę i wybierz kartotekę.' });
            if (!(yield prisma.folder.findFirst({ where: { id: Number(req.body.folderId), ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })))
                return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
            const retentionValue = Number(req.body.retentionValue);
            const retentionUnit = String(req.body.retentionUnit || 'years');
            if (!req.body.title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(retentionUnit)) {
                removeTemporaryFiles();
                return res.status(400).json({ error: 'Nieprawidłowa nazwa dokumentu lub retencja.' });
            }
            const pdf = yield pdf_lib_1.PDFDocument.create();
            for (const file of files) {
                const bytes = fs_1.default.readFileSync(file.path);
                const image = file.mimetype === 'image/png' ? yield pdf.embedPng(new Uint8Array(bytes)) : yield pdf.embedJpg(new Uint8Array(bytes));
                const page = pdf.addPage([image.width, image.height]);
                page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
            }
            const filename = 'SCAN_DOCUMENT_' + (0, node_crypto_1.randomUUID)() + '.pdf';
            outputPath = path_1.default.join(paths_1.uploadsDir, filename);
            fs_1.default.writeFileSync(outputPath, yield pdf.save(), { flag: 'wx' });
            removeTemporaryFiles();
            const key = (0, ocrPremium_1.ocrOwnerKey)(res);
            const plan = yield (0, planLedger_1.getPlan)(prisma, key);
            yield (0, planLedger_1.ensurePlanLedger)(prisma);
            const digest = yield (0, duplicateDocuments_1.hashFile)(outputPath);
            const document = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, Number(res.locals.userId || 1), Number(req.body.folderId), digest);
                yield (0, planLedger_1.checkDocumentCapacity)(tx, Number(res.locals.userId || 1), plan, 1);
                yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'cameraScan', (0, node_crypto_1.randomUUID)(), files.length);
                if (files.length > 1)
                    yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'merge', (0, node_crypto_1.randomUUID)(), 1);
                return tx.document.create({ data: {
                        title: String(req.body.title).slice(0, 255), filePath: filename, folderId: Number(req.body.folderId), mimeType: 'application/pdf',
                        retentionEnabled: req.body.retentionEnabled !== false && req.body.retentionEnabled !== 'false', retentionValue, retentionUnit,
                    } });
            }));
            outputPath = '';
            void (0, ocrEnqueue_1.enqueuePremiumOcr)(prisma, ocrQueue, res, document.id);
            res.status(201).json(document);
        }
        catch (error) {
            removeTemporaryFiles();
            if (outputPath && fs_1.default.existsSync(outputPath))
                fs_1.default.unlinkSync(outputPath);
            if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
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
        var _a, _b, _c, _d;
        const { draftId, folderId, title, retentionValue: rawRetentionValue, retentionUnit = 'years', retentionEnabled = false, thumbnail } = req.body || {};
        let outputPath = '';
        try {
            const retentionValue = Number(rawRetentionValue);
            if (!validDraftId(draftId) || !folderId || !title || !Number.isInteger(retentionValue) || retentionValue < 1 || !RETENTION_UNITS.includes(String(retentionUnit))) {
                return res.status(400).json({ error: 'Nieprawidłowe dane dokumentu.' });
            }
            if (!(yield prisma.folder.findFirst({ where: { id: Number(folderId), ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })))
                return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
            const key = (0, ocrPremium_1.ocrOwnerKey)(res);
            const plan = yield (0, planLedger_1.getPlan)(prisma, key);
            yield (0, planLedger_1.ensurePlanLedger)(prisma);
            const pageKeys = (_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.pageKeys) !== null && _b !== void 0 ? _b : [];
            if (!Array.isArray(pageKeys) || pageKeys.length > 50 || pageKeys.some(item => typeof item !== 'string' || item.length > 255))
                return res.status(400).json({ error: 'Nieprawidłowa lista stron.' });
            const fingerprint = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({ folderId: Number(folderId), title: String(title), retentionValue, retentionUnit, retentionEnabled: Boolean(retentionEnabled), pageKeys })).digest('hex');
            const receipts = yield prisma.$queryRaw `SELECT documentId, fingerprint FROM PlanScanReceipt WHERE ownerKey = ${key} AND draftId = ${String(draftId)}`;
            if (receipts.length) {
                if (receipts[0].fingerprint !== fingerprint)
                    return res.status(409).json({ error: 'Ta wersja robocza została już zapisana z innymi ustawieniami.' });
                const existing = yield prisma.document.findFirst({ where: { id: Number(receipts[0].documentId), folder: { ownerId: Number(res.locals.userId || 1) } } });
                if (!existing)
                    return res.status(409).json({ error: 'Wersja robocza została już zapisana, ale dokument nie jest już dostępny.' });
                try {
                    fs_1.default.rmSync(getDraftDir(draftId), { recursive: true, force: true });
                }
                catch (_e) {
                    console.error('[scan] Nie udało się usunąć ponowionego szkicu.');
                }
                return res.status(200).json(existing);
            }
            const draftDir = getDraftDir(draftId);
            if (!fs_1.default.existsSync(draftDir))
                return res.status(400).json({ error: 'Nie znaleziono wersji roboczej na komputerze.' });
            const pagePaths = fs_1.default.readdirSync(draftDir).filter((name) => /^page-\d{3}\.jpg$/.test(name)).sort().map((name) => path_1.default.join(draftDir, name));
            if (!pagePaths.length)
                return res.status(400).json({ error: 'Wersja robocza nie zawiera stron.' });
            if (pageKeys.length && pageKeys.length !== pagePaths.length)
                return res.status(400).json({ error: 'Liczba przesłanych stron nie zgadza się ze szkicem.' });
            const pdf = yield pdf_lib_1.PDFDocument.create();
            for (const pagePath of pagePaths) {
                const image = yield pdf.embedJpg(new Uint8Array(fs_1.default.readFileSync(pagePath)));
                const page = pdf.addPage([image.width, image.height]);
                page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
            }
            const filename = 'SCAN_DOCUMENT_' + (0, node_crypto_1.randomUUID)() + '.pdf';
            outputPath = path_1.default.join(paths_1.uploadsDir, filename);
            fs_1.default.writeFileSync(outputPath, yield pdf.save(), { flag: 'wx' });
            const printerJobs = (_d = (_c = req.body) === null || _c === void 0 ? void 0 : _c.printerJobs) !== null && _d !== void 0 ? _d : [];
            if (!Array.isArray(printerJobs) || printerJobs.length > pagePaths.length || printerJobs.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
                fs_1.default.unlinkSync(outputPath);
                return res.status(400).json({ error: 'Nieprawidłowe strony drukarki.' });
            }
            const digest = yield (0, duplicateDocuments_1.hashFile)(outputPath);
            const document = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, Number(res.locals.userId || 1), Number(folderId), digest);
                yield (0, planLedger_1.checkDocumentCapacity)(tx, Number(res.locals.userId || 1), plan, 1);
                const printerCount = yield (0, planLedger_1.claimPrinterPages)(tx, key, String(draftId), printerJobs);
                const cameraPages = pagePaths.length - printerCount;
                if (cameraPages)
                    yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'cameraScan', String(draftId), cameraPages);
                if (pagePaths.length > 1)
                    yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'merge', String(draftId), 1);
                const saved = yield tx.document.create({ data: {
                        title: String(title).slice(0, 255), filePath: filename, folderId: Number(folderId), mimeType: 'application/pdf',
                        retentionEnabled: Boolean(retentionEnabled), retentionValue, retentionUnit: String(retentionUnit),
                        thumbnail: typeof thumbnail === 'string' && /^data:image\/jpeg;base64,/.test(thumbnail) && thumbnail.length <= 300000 ? thumbnail : null,
                    } });
                yield tx.$executeRaw `INSERT INTO PlanScanReceipt(ownerKey,draftId,documentId,fingerprint) VALUES (${key},${String(draftId)},${saved.id},${fingerprint})`;
                return saved;
            }));
            outputPath = '';
            void (0, ocrEnqueue_1.enqueuePremiumOcr)(prisma, ocrQueue, res, document.id);
            try {
                fs_1.default.rmSync(draftDir, { recursive: true, force: true });
            }
            catch (error) {
                console.error('[scan] Nie udało się usunąć szkicu:', (0, errors_1.errorMessage)(error));
            }
            res.status(201).json(document);
        }
        catch (error) {
            if (outputPath && fs_1.default.existsSync(outputPath))
                fs_1.default.unlinkSync(outputPath);
            if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
            console.error('[/api/mobile-scan-draft/finalize] BŁĄD:', (0, errors_1.errorMessage)(error));
            res.status(500).json({ error: 'Nie udało się scalić dokumentu do PDF.' });
        }
    }));
    return router;
}
