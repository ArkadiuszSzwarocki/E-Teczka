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
exports.createScannerInboxRouter = createScannerInboxRouter;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const paths_1 = require("../config/paths");
const mergeDocuments_1 = require("../services/mergeDocuments");
const base64DataUrl_1 = require("../services/base64DataUrl");
const folders_1 = require("../services/folders");
const ocrPremium_1 = require("../services/ocrPremium");
const planLedger_1 = require("../services/planLedger");
const ocrEnqueue_1 = require("../services/ocrEnqueue");
const duplicateDocuments_1 = require("../services/duplicateDocuments");
const scannedPdfArchive_1 = require("../services/scannedPdfArchive");
const validId = (id) => /^[0-9a-f-]{36}$/i.test(id);
function uniqueTitle(title, existing) {
    const used = new Set(existing.map(value => value.toLocaleLowerCase('pl-PL')));
    if (!used.has(title.toLocaleLowerCase('pl-PL')))
        return title;
    const extension = path_1.default.extname(title);
    const base = title.slice(0, title.length - extension.length);
    let number = 2;
    while (used.has(`${base} (${number})${extension}`.toLocaleLowerCase('pl-PL')))
        number++;
    return `${base} (${number})${extension}`;
}
function createScannerInboxRouter(prisma, ocrQueue) {
    const router = express_1.default.Router();
    const moving = new Set();
    const directory = (res) => path_1.default.join(paths_1.uploadsDir, '.scanner-inbox', String(Number(res.locals.userId || 1)));
    router.get('/', (_req, res) => {
        const dir = directory(res);
        fs_1.default.mkdirSync(dir, { recursive: true });
        const scans = fs_1.default.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
            try {
                const info = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dir, name), 'utf8'));
                return validId(info.id) && fs_1.default.existsSync(path_1.default.join(dir, `${info.id}.pdf`)) ? [info] : [];
            }
            catch (_a) {
                return [];
            }
        });
        res.json(scans.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const { files, title, retention } = req.body || {};
        if (!Array.isArray(files) || !files.length || files.length > 20 || files.some((file) => !(0, base64DataUrl_1.parseBase64DataUrl)(file === null || file === void 0 ? void 0 : file.data)))
            return res.status(400).json({ error: 'Nieprawidłowe strony skanu.' });
        if (typeof title !== 'string' || !title.trim() || title.length > 240 || !retention || typeof retention.enabled !== 'boolean' || !Number.isInteger(retention.value) || retention.value < 1 || !['years', 'months', 'days'].includes(retention.unit))
            return res.status(400).json({ error: 'Sprawdź nazwę i termin życia dokumentu.' });
        try {
            const source = yield (0, mergeDocuments_1.mergeDocuments)(files);
            const imageOnly = files.every((file) => { const parsed = (0, base64DataUrl_1.parseBase64DataUrl)(file.data); return (parsed === null || parsed === void 0 ? void 0 : parsed.mimeType) === 'image/jpeg' || (parsed === null || parsed === void 0 ? void 0 : parsed.mimeType) === 'image/png'; });
            const archive = imageOnly ? yield (0, scannedPdfArchive_1.prepareScannedPdf)(source) : { bytes: Buffer.from(source), pdfa: false, warning: 'Plik zawiera inne materiały niż obrazy; zapisano zwykły PDF.' };
            const pdf = archive.bytes;
            const key = (0, ocrPremium_1.ocrOwnerKey)(res);
            const plan = yield (0, planLedger_1.getPlan)(prisma, key);
            yield (0, planLedger_1.ensurePlanLedger)(prisma);
            const id = crypto_1.default.randomUUID();
            const dir = directory(res);
            fs_1.default.mkdirSync(dir, { recursive: true });
            const requestedTitle = title.trim().toLowerCase().endsWith('.pdf') ? title.trim() : `${title.trim()}.pdf`;
            const existingTitles = fs_1.default.readdirSync(dir).filter(name => name.endsWith('.json')).flatMap(name => {
                try {
                    const existing = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dir, name), 'utf8'));
                    return typeof existing.title === 'string' ? [existing.title] : [];
                }
                catch (_a) {
                    return [];
                }
            });
            const info = { id, title: uniqueTitle(requestedTitle, existingTitles), createdAt: new Date().toISOString(), retentionEnabled: retention.enabled, retentionValue: retention.value, retentionUnit: retention.unit, pdfa: archive.pdfa, pdfaWarning: archive.warning };
            yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () { yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'printerScan', id, files.length); if (files.length > 1)
                yield (0, planLedger_1.consumeUsage)(tx, key, plan, 'merge', id, 1); fs_1.default.writeFileSync(path_1.default.join(dir, `${id}.pdf`), pdf, { flag: 'wx' }); try {
                fs_1.default.writeFileSync(path_1.default.join(dir, `${id}.json`), JSON.stringify(info), { flag: 'wx' });
            }
            catch (error) {
                fs_1.default.unlinkSync(path_1.default.join(dir, `${id}.pdf`));
                throw error;
            } }));
            res.status(201).json(info);
        }
        catch (error) {
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt });
            res.status(500).json({ error: 'Nie udało się zapisać skanu w folderze tymczasowym.' });
        }
    }));
    router.patch('/:id', (req, res) => {
        var _a;
        const id = req.params.id;
        const ownerId = Number(res.locals.userId || 1);
        const title = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.title) === 'string' ? req.body.title.trim() : '';
        if (!validId(id) || !title || title.length > 240 || /[\r\n\x00-\x1f]/.test(title))
            return res.status(400).json({ error: 'Podaj prawidłową nazwę dokumentu.' });
        const dir = directory(res);
        const file = path_1.default.join(dir, `${id}.json`);
        if (!fs_1.default.existsSync(file) || !fs_1.default.existsSync(path_1.default.join(dir, `${id}.pdf`)))
            return res.status(404).json({ error: 'Skan nie jest dostępny.' });
        if (moving.has(`${ownerId}:${id}`))
            return res.status(409).json({ error: 'Skan jest w trakcie przenoszenia.' });
        let temp = '';
        try {
            const info = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
            const names = fs_1.default.readdirSync(dir).filter(name => name.endsWith('.json') && name !== `${id}.json`).flatMap(name => {
                try {
                    const item = JSON.parse(fs_1.default.readFileSync(path_1.default.join(dir, name), 'utf8'));
                    return typeof item.title === 'string' ? [item.title] : [];
                }
                catch (_a) {
                    return [];
                }
            });
            info.title = uniqueTitle(title.toLowerCase().endsWith('.pdf') ? title : `${title}.pdf`, names);
            temp = path_1.default.join(dir, `${id}.${crypto_1.default.randomUUID()}.tmp`);
            fs_1.default.writeFileSync(temp, JSON.stringify(info), { flag: 'wx' });
            fs_1.default.renameSync(temp, file);
            res.json(info);
        }
        catch (_b) {
            if (temp && fs_1.default.existsSync(temp))
                fs_1.default.unlinkSync(temp);
            res.status(500).json({ error: 'Nie udało się zmienić nazwy skanu.' });
        }
    });
    router.post('/:id/move', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const id = req.params.id;
        const folderId = Number((_a = req.body) === null || _a === void 0 ? void 0 : _a.folderId);
        const ownerId = Number(res.locals.userId || 1);
        if (!validId(id))
            return res.status(400).json({ error: 'Nieprawidłowy skan.' });
        const folder = yield prisma.folder.findFirst({ where: { id: folderId, ownerId } });
        if (!folder || !(yield (0, folders_1.isDocumentFolder)(prisma, folderId)))
            return res.status(400).json({ error: 'Wybierz własną podkartotekę.' });
        const dir = directory(res);
        const metaPath = path_1.default.join(dir, `${id}.json`);
        const scanPath = path_1.default.join(dir, `${id}.pdf`);
        if (!fs_1.default.existsSync(metaPath) || !fs_1.default.existsSync(scanPath))
            return res.status(404).json({ error: 'Skan nie jest dostępny.' });
        if (moving.has(`${ownerId}:${id}`) || moving.has(`folder:${folderId}`))
            return res.status(409).json({ error: 'Trwa już przenoszenie do tej kartoteki. Spróbuj ponownie.' });
        moving.add(`${ownerId}:${id}`);
        moving.add(`folder:${folderId}`);
        try {
            const info = JSON.parse(fs_1.default.readFileSync(metaPath, 'utf8'));
            const existing = yield prisma.document.findMany({ where: { folderId }, select: { title: true } });
            const finalTitle = uniqueTitle(info.title, existing.map(document => document.title));
            const filename = `${crypto_1.default.randomUUID()}.pdf`;
            const destination = path_1.default.join(paths_1.uploadsDir, filename);
            fs_1.default.copyFileSync(scanPath, destination, fs_1.default.constants.COPYFILE_EXCL);
            let saved;
            try {
                const plan = yield (0, planLedger_1.getPlan)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res));
                saved = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () { yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId, folderId, yield (0, duplicateDocuments_1.hashFile)(scanPath)); yield (0, planLedger_1.checkDocumentCapacity)(tx, ownerId, plan, 1); return tx.document.create({ data: { title: finalTitle, filePath: filename, mimeType: 'application/pdf', folderId, userId: res.locals.userId || null, retentionEnabled: info.retentionEnabled, retentionValue: info.retentionValue, retentionUnit: info.retentionUnit } }); }));
            }
            catch (error) {
                fs_1.default.unlinkSync(destination);
                throw error;
            }
            void (0, ocrEnqueue_1.enqueuePremiumOcr)(prisma, ocrQueue, res, saved.id);
            try {
                fs_1.default.unlinkSync(metaPath);
                fs_1.default.unlinkSync(scanPath);
            }
            catch (error) {
                console.error('[scanner] Nie udało się usunąć pliku tymczasowego:', error);
            }
            res.json(saved);
        }
        catch (error) {
            if (error instanceof duplicateDocuments_1.DuplicateDocumentError)
                return res.status(409).json({ code: error.code, error: error.message, existingTitle: error.existingTitle });
            if (error instanceof planLedger_1.PlanLimitError)
                return res.status(403).json({ code: error.code, error: error.message });
            res.status(500).json({ error: 'Nie udało się przenieść skanu.' });
        }
        finally {
            moving.delete(`${ownerId}:${id}`);
            moving.delete(`folder:${folderId}`);
        }
    }));
    return router;
}
