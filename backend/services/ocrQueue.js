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
exports.createOcrQueue = createOcrQueue;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const backupCrypto_1 = require("./backupCrypto");
const ocrText_1 = require("./ocrText");
const ocrEngine_1 = require("./ocrEngine");
const financeOcrParser_1 = require("./financeOcrParser");
const receiptOcrParser_1 = require("./receiptOcrParser");
const planLedger_1 = require("./planLedger");
/** Durable, serialized local queue. The state and recognized text are encrypted on disk. */
function createOcrQueue(prisma, options) {
    let running = false;
    const extract = options.extract || ocrEngine_1.extractDocumentText;
    function read() {
        let value;
        try {
            value = node_fs_1.default.readFileSync(options.file, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
        const result = JSON.parse((0, backupCrypto_1.decrypt)(value));
        if (!Array.isArray(result))
            throw new Error('Nie można odczytać kolejki OCR.');
        return result;
    }
    function write(jobs) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(options.file), { recursive: true });
        const temporary = `${options.file}.${node_crypto_1.default.randomBytes(8).toString('hex')}.tmp`;
        try {
            node_fs_1.default.writeFileSync(temporary, (0, backupCrypto_1.encrypt)(JSON.stringify(jobs)), { mode: 0o600, flag: 'wx' });
            node_fs_1.default.renameSync(temporary, options.file);
        }
        finally {
            try {
                node_fs_1.default.unlinkSync(temporary);
            }
            catch ( /* renamed */_a) { /* renamed */ }
        }
    }
    function update(id, ownerKey, patch) {
        const jobs = read();
        const index = jobs.findIndex(job => job.documentId === id && job.ownerKey === ownerKey);
        if (index < 0)
            return;
        jobs[index] = Object.assign(Object.assign(Object.assign({}, jobs[index]), patch), { updatedAt: Date.now() });
        write(jobs);
    }
    function enqueue(documentId, ownerKey) {
        const jobs = read();
        const index = jobs.findIndex(job => job.documentId === documentId && job.ownerKey === ownerKey);
        if (index >= 0 && (jobs[index].state === 'queued' || jobs[index].state === 'processing'))
            return;
        const job = { documentId, ownerKey, state: 'queued', updatedAt: Date.now() };
        if (index >= 0)
            jobs[index] = job;
        else
            jobs.push(job);
        write(jobs);
        void process().catch(error => console.error('[ocr] Kolejka:', error instanceof Error ? error.message : 'błąd'));
    }
    function status(documentId, ownerKey) {
        const job = read().find(item => item.documentId === documentId && item.ownerKey === ownerKey);
        return job ? { state: job.state, error: job.error || null, updatedAt: job.updatedAt } : { state: 'not_started', error: null };
    }
    function process() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (running)
                return;
            running = true;
            try {
                // Interrupted work can be retried after the process restarts.
                const jobs = read();
                let changed = false;
                for (const job of jobs)
                    if (job.state === 'processing') {
                        job.state = 'queued';
                        changed = true;
                    }
                if (changed)
                    write(jobs);
                for (;;) {
                    const next = read().find(job => job.state === 'queued');
                    if (!next)
                        break;
                    if (!(yield (0, planLedger_1.featureTrial)(prisma, next.ownerKey, 'ocr', false)).allowed) {
                        update(next.documentId, next.ownerKey, { state: 'paused', error: 'Okres próbny OCR zakończył się. Funkcja wymaga planu Premium.' });
                        continue;
                    }
                    update(next.documentId, next.ownerKey, { state: 'processing', error: undefined });
                    try {
                        const document = yield prisma.document.findUnique({ where: { id: next.documentId }, select: { id: true, filePath: true, mimeType: true, isDeleted: true, merchantName: true, amountCents: true, dueDate: true, paymentStatus: true } });
                        if (!document || document.isDeleted)
                            throw new Error('Dokument nie jest dostępny.');
                        const fullPath = node_path_1.default.resolve(options.uploadsDirectory, document.filePath);
                        const relative = node_path_1.default.relative(node_path_1.default.resolve(options.uploadsDirectory), fullPath);
                        if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative))
                            throw new Error('Nieprawidłowa ścieżka dokumentu.');
                        const text = yield extract(fullPath, document.mimeType);
                        if (text.length > 2000000)
                            throw new Error('Dokument przekracza limit 2 milionów znaków tekstu OCR.');
                        const extracted = (0, financeOcrParser_1.extractFinanceFromOcr)(text);
                        const receipt = (0, receiptOcrParser_1.parseReceiptFromOcr)(text);
                        const financePatch = {};
                        if (!document.merchantName && receipt.merchantName)
                            financePatch.merchantName = receipt.merchantName;
                        const detectedCents = (_a = receipt.amountCents) !== null && _a !== void 0 ? _a : extracted.amountCents;
                        if (document.amountCents === null && detectedCents !== null) {
                            financePatch.amountCents = detectedCents;
                            financePatch.currency = extracted.currency || 'PLN';
                            if (!document.paymentStatus)
                                financePatch.paymentStatus = receipt.paymentStatus || 'unpaid';
                        }
                        else if (!document.paymentStatus && receipt.paymentStatus) {
                            financePatch.paymentStatus = receipt.paymentStatus;
                        }
                        if (document.dueDate === null && extracted.dueDate !== null) {
                            financePatch.dueDate = extracted.dueDate;
                        }
                        const updated = yield prisma.document.updateMany({ where: { id: document.id, filePath: document.filePath, isDeleted: false }, data: Object.assign({ ocrText: (0, ocrText_1.protectOcrText)(text) }, financePatch) });
                        if (updated.count !== 1)
                            throw new Error('Dokument zmienił się podczas rozpoznawania.');
                        if (receipt.items.length > 0) {
                            yield prisma.documentLineItem.deleteMany({ where: { documentId: document.id } });
                            yield prisma.documentLineItem.createMany({
                                data: receipt.items.map(item => ({
                                    documentId: document.id,
                                    name: item.name,
                                    quantity: item.quantity,
                                    totalCents: item.totalCents,
                                    category: item.category,
                                })),
                            });
                        }
                        update(next.documentId, next.ownerKey, { state: 'done' });
                    }
                    catch (error) {
                        const message = error instanceof Error && /Brak lokalnego pliku językowego|przekracza limit|format dokumentu|nie jest dostępny|Dokument zmienił/.test(error.message) ? error.message : 'Nie udało się rozpoznać dokumentu. Sprawdź plik i spróbuj ponownie.';
                        update(next.documentId, next.ownerKey, { state: 'error', error: message });
                    }
                }
            }
            finally {
                running = false;
            }
        });
    }
    return { enqueue, status, process };
}
