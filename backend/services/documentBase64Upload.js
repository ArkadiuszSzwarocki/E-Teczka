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
exports.saveMergedBase64Document = saveMergedBase64Document;
exports.saveBatchBase64Documents = saveBatchBase64Documents;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const paths_1 = require("../config/paths");
const errors_1 = require("../utils/errors");
const base64DataUrl_1 = require("./base64DataUrl");
const duplicateDocuments_1 = require("./duplicateDocuments");
const mergeDocuments_1 = require("./mergeDocuments");
const planLedger_1 = require("./planLedger");
/** Merges multiple uploaded files into one PDF document and persists it atomically. */
function saveMergedBase64Document(prisma, params) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, planLedger_1.ensurePlanLedger)(prisma);
        const merged = yield (0, mergeDocuments_1.mergeDocuments)(params.files);
        const filename = `${Date.now()}-${(0, node_crypto_1.randomUUID)()}.pdf`;
        const destination = node_path_1.default.join(paths_1.uploadsDir, filename);
        node_fs_1.default.writeFileSync(destination, merged, { flag: 'wx' });
        try {
            return yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, params.owner, params.folderId, (0, duplicateDocuments_1.hashBuffer)(merged));
                yield (0, planLedger_1.checkDocumentCapacity)(tx, params.owner, params.plan, 1);
                yield (0, planLedger_1.consumeUsage)(tx, params.ownerKey, params.plan, 'merge', (0, node_crypto_1.randomUUID)(), 1);
                return tx.document.create({
                    data: {
                        title: params.title,
                        filePath: filename,
                        mimeType: 'application/pdf',
                        folderId: params.folderId,
                        physicalLocation: params.physicalLocation,
                        retentionEnabled: params.retention.enabled,
                        retentionValue: params.retention.value,
                        retentionUnit: params.retention.unit,
                        userId: params.userId,
                    },
                });
            }));
        }
        catch (error) {
            node_fs_1.default.unlinkSync(destination);
            throw error;
        }
    });
}
/** Saves a batch of base64 files, skipping duplicates and rolling back written files on failure. */
function saveBatchBase64Documents(prisma, params) {
    return __awaiter(this, void 0, void 0, function* () {
        const writtenFiles = [];
        const skippedDuplicates = [];
        const prepared = params.files.map((file, i) => {
            const retention = params.retentions[i] || {};
            const retentionEnabled = retention.enabled !== false;
            const retentionValue = Number(retention.value) || 5;
            const retentionUnit = ['years', 'months', 'days', 'minutes'].includes(String(retention.unit)) ? String(retention.unit) : 'years';
            const decoded = (0, base64DataUrl_1.parseBase64DataUrl)(file.data);
            if (!decoded)
                throw new Error('Nieprawidłowe dane pliku.');
            const content = Buffer.from(decoded.base64, 'base64');
            return {
                file,
                retentionEnabled,
                retentionValue,
                retentionUnit,
                mimeType: decoded.mimeType,
                content,
                digest: (0, duplicateDocuments_1.hashBuffer)(content),
            };
        });
        try {
            const savedDocs = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const documents = [];
                for (const item of prepared) {
                    const { file, retentionEnabled, retentionValue, retentionUnit, mimeType, content, digest } = item;
                    try {
                        yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, params.owner, params.folderId, digest);
                    }
                    catch (error) {
                        if (error instanceof duplicateDocuments_1.DuplicateDocumentError) {
                            skippedDuplicates.push({ name: file.name, existingTitle: error.existingTitle });
                            continue;
                        }
                        throw error;
                    }
                    yield (0, planLedger_1.checkDocumentCapacity)(tx, params.owner, params.plan, 1);
                    const extension = node_path_1.default.extname(file.name).toLowerCase();
                    const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
                    const filename = `${(0, node_crypto_1.randomUUID)()}${safeExtension}`;
                    const destination = node_path_1.default.join(paths_1.uploadsDir, filename);
                    node_fs_1.default.writeFileSync(destination, content, { flag: 'wx' });
                    writtenFiles.push(destination);
                    documents.push(yield tx.document.create({
                        data: {
                            title: file.name,
                            filePath: filename,
                            mimeType,
                            folderId: params.folderId,
                            physicalLocation: params.physicalLocation,
                            retentionEnabled,
                            retentionValue,
                            retentionUnit,
                            thumbnail: file.thumbnail || null,
                            userId: params.userId,
                        },
                    }));
                }
                return documents;
            }), { maxWait: 15000, timeout: 60000 });
            return { savedDocs, skippedDuplicates };
        }
        catch (error) {
            for (const destination of writtenFiles) {
                try {
                    node_fs_1.default.unlinkSync(destination);
                }
                catch (cleanupError) {
                    console.error('[upload] Nie udało się usunąć pliku po błędzie zapisu:', (0, errors_1.errorMessage)(cleanupError));
                }
            }
            throw error;
        }
    });
}
