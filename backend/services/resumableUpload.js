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
exports.initResumableSession = initResumableSession;
exports.writeResumableChunk = writeResumableChunk;
exports.completeResumableSession = completeResumableSession;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const paths_1 = require("../config/paths");
const duplicateDocuments_1 = require("./duplicateDocuments");
const planLedger_1 = require("./planLedger");
const safeId = (raw) => /^[A-Za-z0-9_-]{8,64}$/.test(raw);
const sessionDir = (baseDir, uploadId) => node_path_1.default.join(baseDir, '.resumable', uploadId);
const metaPath = (baseDir, uploadId) => node_path_1.default.join(sessionDir(baseDir, uploadId), 'meta.json');
const chunkPath = (baseDir, uploadId, index) => node_path_1.default.join(sessionDir(baseDir, uploadId), `${index}.part`);
function initResumableSession(input, baseDir = paths_1.uploadsDir) {
    const uploadId = input.uploadId && safeId(input.uploadId) ? input.uploadId : node_crypto_1.default.randomUUID();
    const dir = sessionDir(baseDir, uploadId);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const mPath = metaPath(baseDir, uploadId);
    if (node_fs_1.default.existsSync(mPath)) {
        const existing = JSON.parse(node_fs_1.default.readFileSync(mPath, 'utf8'));
        if (existing.ownerId !== input.ownerId || existing.folderId !== input.folderId || existing.totalChunks !== input.totalChunks) {
            throw new Error('Sesja uploadu nie pasuje do wybranego pliku lub kartoteki.');
        }
    }
    else {
        const meta = {
            uploadId,
            ownerId: input.ownerId,
            folderId: input.folderId,
            fileName: node_path_1.default.basename(input.fileName).slice(0, 180) || 'dokument.bin',
            mimeType: input.mimeType || 'application/octet-stream',
            totalChunks: input.totalChunks,
            createdAt: Date.now(),
        };
        node_fs_1.default.writeFileSync(mPath, JSON.stringify(meta));
    }
    const receivedChunks = [];
    for (let i = 0; i < input.totalChunks; i++) {
        if (node_fs_1.default.existsSync(chunkPath(baseDir, uploadId, i)))
            receivedChunks.push(i);
    }
    return { uploadId, receivedChunks };
}
function writeResumableChunk(uploadId, ownerId, index, base64Data, baseDir = paths_1.uploadsDir) {
    if (!safeId(uploadId) || !Number.isInteger(index) || index < 0) {
        throw new Error('Nieprawidłowy identyfikator części pliku.');
    }
    const mPath = metaPath(baseDir, uploadId);
    if (!node_fs_1.default.existsSync(mPath))
        throw new Error('Sesja uploadu nie istnieje.');
    const meta = JSON.parse(node_fs_1.default.readFileSync(mPath, 'utf8'));
    if (meta.ownerId !== ownerId || index >= meta.totalChunks) {
        throw new Error('Brak uprawnień lub nieprawidłowy numer części.');
    }
    const dest = chunkPath(baseDir, uploadId, index);
    const tmp = `${dest}.tmp`;
    node_fs_1.default.writeFileSync(tmp, Buffer.from(base64Data, 'base64'));
    node_fs_1.default.renameSync(tmp, dest);
}
function completeResumableSession(prisma_1, uploadId_1, ownerId_1, userId_1, plan_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, uploadId, ownerId, userId, plan, baseDir = paths_1.uploadsDir) {
        if (!safeId(uploadId))
            throw new Error('Nieprawidłowy identyfikator sesji.');
        const mPath = metaPath(baseDir, uploadId);
        if (!node_fs_1.default.existsSync(mPath))
            throw new Error('Sesja uploadu wygasła lub nie istnieje.');
        const meta = JSON.parse(node_fs_1.default.readFileSync(mPath, 'utf8'));
        if (meta.ownerId !== ownerId)
            throw new Error('Brak uprawnień do sesji uploadu.');
        const buffers = [];
        for (let i = 0; i < meta.totalChunks; i++) {
            const p = chunkPath(baseDir, uploadId, i);
            if (!node_fs_1.default.existsSync(p))
                throw new Error(`Brakuje części pliku nr ${i}.`);
            buffers.push(node_fs_1.default.readFileSync(p));
        }
        const fullBuffer = Buffer.concat(buffers);
        const digest = node_crypto_1.default.createHash('sha256').update(fullBuffer).digest('hex');
        const ext = node_path_1.default.extname(meta.fileName).toLowerCase() || '.bin';
        const storedName = `${node_crypto_1.default.randomUUID()}${ext}`;
        const finalPath = node_path_1.default.join(baseDir, storedName);
        try {
            node_fs_1.default.writeFileSync(finalPath, fullBuffer);
            const document = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId, meta.folderId, digest);
                yield (0, planLedger_1.checkDocumentCapacity)(tx, ownerId, plan, 1);
                return tx.document.create({
                    data: {
                        title: meta.fileName,
                        filePath: storedName,
                        mimeType: meta.mimeType,
                        folderId: meta.folderId,
                        userId,
                        retentionEnabled: true,
                        retentionValue: 5,
                        retentionUnit: 'years',
                    },
                });
            }));
            node_fs_1.default.rmSync(sessionDir(baseDir, uploadId), { recursive: true, force: true });
            return document;
        }
        catch (error) {
            node_fs_1.default.rmSync(finalPath, { force: true });
            throw error;
        }
    });
}
