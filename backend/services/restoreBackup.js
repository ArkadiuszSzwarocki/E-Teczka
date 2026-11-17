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
exports.restoreBackup = restoreBackup;
const planLedger_1 = require("./planLedger");
const centralPlanLedger_1 = require("./centralPlanLedger");
const tagOwnership_1 = require("./tagOwnership");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const paths_1 = require("../config/paths");
const backupCrypto_1 = require("./backupCrypto");
const ocrText_1 = require("./ocrText");
function parseManifest(zip) {
    const entry = zip.getEntry('manifest.json');
    if (!entry)
        throw new Error('Nieprawidłowa kopia: brak manifestu.');
    let value;
    try {
        value = JSON.parse(entry.getData().toString('utf8'));
    }
    catch (_a) {
        throw new Error('Nieprawidłowy manifest kopii.');
    }
    if ((value === null || value === void 0 ? void 0 : value.version) !== 1 || !Array.isArray(value.folders) || !Array.isArray(value.documents))
        throw new Error('Nieobsługiwana wersja kopii zapasowej.');
    const folderIds = new Set();
    for (const folder of value.folders) {
        if (!Number.isInteger(folder.id) || folder.id < 1 || folderIds.has(folder.id) || typeof folder.name !== 'string')
            throw new Error('Nieprawidłowe kartoteki w kopii.');
        folderIds.add(folder.id);
    }
    const documentIds = new Set();
    for (const document of value.documents) {
        if (!Number.isInteger(document.id) || document.id < 1 || documentIds.has(document.id) || !folderIds.has(document.folderId) || typeof document.filePath !== 'string' || !document.filePath || typeof document.title !== 'string')
            throw new Error('Nieprawidłowe dokumenty w kopii.');
        documentIds.add(document.id);
        if (!zip.getEntry(`files/${document.id}-${path_1.default.basename(document.filePath)}`))
            throw new Error(`Brak pliku dokumentu ${document.id} w kopii.`);
    }
    for (const folder of value.folders)
        if (folder.parentId && !folderIds.has(folder.parentId))
            throw new Error('Nieprawidłowa hierarchia kartotek.');
    return value;
}
function restoreBackup(prisma_1, encryptedData_1, ownerId_1, userId_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, encryptedData, ownerId, userId, targetDir = paths_1.uploadsDir, recoveryKey, planOwnerKey = userId ? `user:${userId}` : 'desktop-local') {
        const central = (0, centralPlanLedger_1.centralOwner)(planOwnerKey);
        if (central)
            yield (0, centralPlanLedger_1.requireSynchronizedCentralPlan)(prisma, planOwnerKey);
        const centralPlan = central ? yield (0, planLedger_1.getPlan)(prisma, planOwnerKey) : null;
        const zip = new adm_zip_1.default((0, backupCrypto_1.decryptBackup)(encryptedData, recoveryKey));
        const manifest = parseManifest(zip);
        const rawManifest = JSON.parse(zip.getEntry('manifest.json').getData().toString('utf8'));
        const planState = (0, planLedger_1.parseBackupPlanState)(rawManifest.planState);
        if (planState)
            yield (0, planLedger_1.ensurePlanLedger)(prisma);
        if (manifest.documents.some(document => { var _a; return (_a = document.tags) === null || _a === void 0 ? void 0 : _a.length; }))
            yield (0, tagOwnership_1.prepareTags)(prisma);
        // Re-encrypt OCR data with this installation's key before committing any changes.
        for (const document of manifest.documents)
            if (typeof document.ocrText === 'string' && document.ocrText)
                document.ocrText = (0, ocrText_1.protectOcrText)((0, ocrText_1.readOcrText)(document.ocrText, recoveryKey));
        const parseDate = (value) => {
            if (!value)
                return undefined;
            const date = new Date(value);
            if (Number.isNaN(date.getTime()))
                throw new Error('Nieprawidłowa data w kopii zapasowej.');
            return date;
        };
        for (const folder of manifest.folders)
            parseDate(folder.createdAt);
        for (const document of manifest.documents) {
            parseDate(document.createdAt);
            parseDate(document.deletedAt);
        }
        const writtenFiles = [];
        const folderMap = new Map();
        try {
            yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                if (central && centralPlan) {
                    const count = yield tx.document.count({ where: { folder: { ownerId } } });
                    const growth = manifest.documents.length - count;
                    if (growth > 0)
                        yield (0, planLedger_1.checkDocumentCapacity)(tx, ownerId, centralPlan, growth);
                    const tables = yield tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='PlanTagOwner'");
                    const existing = tables.length ? yield tx.$queryRawUnsafe('SELECT t.name FROM Tag t JOIN PlanTagOwner o ON o.tagId=t.id WHERE o.ownerId=?', ownerId) : [];
                    const names = new Set(existing.map(t => t.name));
                    const added = new Set(manifest.documents.flatMap(d => (d.tags || []).map(t => String(t.name || 'tag').slice(0, 80))).filter(name => !names.has(name)));
                    if (added.size)
                        yield (0, planLedger_1.checkTagCapacity)(tx, ownerId, centralPlan, existing.length, added.size);
                }
                if (planState)
                    yield (0, planLedger_1.mergePlanState)(tx, planOwnerKey, planState);
                // The archive is a snapshot, not an import. Replace only this owner's
                // data inside one transaction. Other accounts must never be touched.
                // Version 1 backups do not contain folder shares. Refuse to discard
                // permissions silently; restore can proceed after they are handled.
                const shares = yield tx.folderShare.count({ where: { folder: { ownerId } } });
                if (shares)
                    throw new Error('Nie można przywrócić kopii: obecne kartoteki są udostępnione innym użytkownikom, a kopia nie zawiera tych uprawnień.');
                const foreignChildren = yield tx.folder.count({ where: { ownerId: { not: ownerId }, parent: { ownerId } } });
                if (foreignChildren)
                    throw new Error('Nie można przywrócić kopii: kartoteki innych użytkowników są podłączone do Twoich kartotek.');
                const otherFolders = new Set((yield tx.folder.findMany({ where: { ownerId: { not: ownerId } }, select: { id: true } })).map(folder => folder.id));
                const otherDocuments = new Set((yield tx.document.findMany({ where: { folder: { ownerId: { not: ownerId } } }, select: { id: true } })).map(document => document.id));
                // Assign collision-free IDs above every reserved ID, even when restoring
                // another account's archive into a database with overlapping IDs.
                let nextFolderId = [...otherFolders, ...manifest.folders.map(folder => folder.id)].reduce((max, id) => Math.max(max, id), 0) + 1;
                let nextDocumentId = [...otherDocuments, ...manifest.documents.map(document => document.id)].reduce((max, id) => Math.max(max, id), 0) + 1;
                yield tx.document.deleteMany({ where: { folder: { ownerId } } });
                yield tx.folder.deleteMany({ where: { ownerId } });
                const pending = [...manifest.folders];
                while (pending.length) {
                    const index = pending.findIndex(folder => !folder.parentId || folderMap.has(folder.parentId));
                    if (index < 0)
                        throw new Error('Nieprawidłowa hierarchia kartotek.');
                    const source = pending.splice(index, 1)[0];
                    const created = yield tx.folder.create({ data: { id: otherFolders.has(source.id) ? nextFolderId++ : source.id, name: source.name.slice(0, 255), parentId: source.parentId ? folderMap.get(source.parentId) : null, ownerId, order: Number(source.order) || 0, createdAt: parseDate(source.createdAt) } });
                    folderMap.set(source.id, created.id);
                }
                for (const source of manifest.documents) {
                    const entry = zip.getEntry(`files/${source.id}-${path_1.default.basename(source.filePath)}`);
                    const filename = `${crypto_1.default.randomUUID()}-${path_1.default.basename(source.filePath)}`;
                    const filepath = path_1.default.join(targetDir, filename);
                    fs_1.default.writeFileSync(filepath, entry.getData(), { flag: 'wx' });
                    writtenFiles.push(filepath);
                    const created = yield tx.document.create({ data: { id: otherDocuments.has(source.id) ? nextDocumentId++ : source.id, title: source.title.slice(0, 255), filePath: filename, mimeType: String(source.mimeType || 'application/octet-stream'), folderId: folderMap.get(source.folderId), userId, retentionEnabled: source.retentionEnabled !== false, retentionValue: Number(source.retentionValue) || 5, retentionUnit: String(source.retentionUnit || 'years'), isArchived: Boolean(source.isArchived), isDeleted: Boolean(source.isDeleted), deletedAt: source.isDeleted ? (parseDate(source.deletedAt) || new Date()) : null, createdAt: parseDate(source.createdAt), physicalLocation: (_a = source.physicalLocation) !== null && _a !== void 0 ? _a : null, thumbnail: (_b = source.thumbnail) !== null && _b !== void 0 ? _b : null, ocrText: typeof source.ocrText === 'string' ? source.ocrText : null } });
                    for (const tag of source.tags || []) {
                        const name = String(tag.name || 'tag').slice(0, 80);
                        const record = yield tx.tag.upsert({ where: { name }, create: { name, color: String(tag.color || '#2563eb') }, update: {} });
                        yield tx.$executeRaw `INSERT OR IGNORE INTO PlanTagOwner(ownerId, tagId) VALUES (${ownerId}, ${record.id})`;
                        yield tx.documentTag.create({ data: { documentId: created.id, tagId: record.id } });
                    }
                }
            }), { timeout: 120000 });
        }
        catch (error) {
            for (const filepath of writtenFiles) {
                try {
                    fs_1.default.unlinkSync(filepath);
                }
                catch ( /* keep the original failure */_a) { /* keep the original failure */ }
            }
            throw error;
        }
        return { restoredFolders: manifest.folders.length, restoredDocuments: manifest.documents.length };
    });
}
