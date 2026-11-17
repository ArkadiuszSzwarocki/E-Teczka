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
exports.importExternalArchive = importExternalArchive;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const paths_1 = require("../config/paths");
const planLedger_1 = require("./planLedger");
const duplicateDocuments_1 = require("./duplicateDocuments");
const MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};
function sanitizeZipPath(raw) {
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..') || node_path_1.default.isAbsolute(normalized)) {
        throw new Error(`Nieprawidłowa ścieżka w archiwum: ${raw}`);
    }
    return normalized;
}
function splitCsvLine(line, delimiter) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            }
            else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === delimiter && !inQuotes) {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    cells.push(current.trim());
    return cells;
}
function parseCsvRecords(csvText) {
    const clean = csvText.replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2)
        return [];
    const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
    const headers = splitCsvLine(lines[0], delimiter).map(h => h.toLowerCase().trim());
    const findCol = (candidates) => headers.findIndex(h => candidates.includes(h));
    const colFolder = findCol(['folder', 'kartoteka', 'category', 'kategoria']);
    const colTitle = findCol(['title', 'tytul', 'tytuł', 'name', 'nazwa']);
    const colFile = findCol(['file', 'filepath', 'plik', 'filename', 'path']);
    const colMime = findCol(['mimetype', 'mime', 'type', 'typ']);
    const colRetVal = findCol(['retentionvalue', 'retention', 'retencja']);
    const colRetUnit = findCol(['retentionunit', 'unit', 'jednostka']);
    if (colFile < 0)
        throw new Error('Plik CSV musi zawierać kolumnę „file” (lub „plik”).');
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i], delimiter);
        const file = cells[colFile] || '';
        if (!file)
            continue;
        const rawUnit = colRetUnit >= 0 ? (cells[colRetUnit] || '').toLowerCase() : '';
        const retentionUnit = rawUnit === 'days' || rawUnit === 'months' || rawUnit === 'years' ? rawUnit : undefined;
        const rawVal = colRetVal >= 0 ? Number(cells[colRetVal]) : NaN;
        records.push({
            folder: (colFolder >= 0 && cells[colFolder]) ? cells[colFolder] : 'Importowane',
            title: (colTitle >= 0 && cells[colTitle]) ? cells[colTitle] : node_path_1.default.basename(file, node_path_1.default.extname(file)),
            file,
            mimeType: colMime >= 0 ? cells[colMime] || undefined : undefined,
            retentionValue: Number.isInteger(rawVal) && rawVal > 0 ? rawVal : undefined,
            retentionUnit,
        });
    }
    return records;
}
function parseJsonRecords(jsonText) {
    const parsed = JSON.parse(jsonText);
    const rows = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray(parsed.documents))
            ? parsed.documents
            : null;
    if (!rows)
        throw new Error('Plik JSON musi zawierać tablicę dokumentów lub pole „documents”.');
    return rows
        .filter((item) => Boolean(item) && typeof item === 'object')
        .map(item => {
        const file = String(item.file || item.filePath || item.plik || item.filename || '').trim();
        const folder = String(item.folder || item.kartoteka || item.category || 'Importowane').trim() || 'Importowane';
        const title = String(item.title || item.tytul || item.name || node_path_1.default.basename(file, node_path_1.default.extname(file))).trim() || 'Dokument';
        const unit = String(item.retentionUnit || '').toLowerCase();
        const retentionUnit = unit === 'days' || unit === 'months' || unit === 'years' ? unit : undefined;
        return {
            folder,
            title,
            file,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
            retentionValue: typeof item.retentionValue === 'number' && item.retentionValue > 0 ? Math.round(item.retentionValue) : undefined,
            retentionUnit,
        };
    })
        .filter(item => Boolean(item.file));
}
function extractRecordsFromZip(zip) {
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const jsonEntry = entries.find(e => /^(index|documents|metadata)\.json$/i.test(node_path_1.default.basename(e.entryName)))
        || entries.find(e => e.entryName.toLowerCase().endsWith('.json') && node_path_1.default.basename(e.entryName).toLowerCase() !== 'manifest.json');
    if (jsonEntry) {
        return parseJsonRecords(jsonEntry.getData().toString('utf8'));
    }
    const csvEntry = entries.find(e => /^(index|documents|metadata)\.csv$/i.test(node_path_1.default.basename(e.entryName)))
        || entries.find(e => e.entryName.toLowerCase().endsWith('.csv'));
    if (csvEntry) {
        return parseCsvRecords(csvEntry.getData().toString('utf8'));
    }
    throw new Error('Archiwum ZIP musi zawierać plik metadanych CSV lub JSON (np. index.csv lub index.json).');
}
/** Imports an external ZIP package (CSV/JSON metadata + binary files) into SQLite and uploadsDir. */
function importExternalArchive(prisma_1, archiveBuffer_1, ownerId_1, userId_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, archiveBuffer, ownerId, userId, targetDir = paths_1.uploadsDir, planOwnerKey = userId ? `user:${userId}` : 'desktop-local') {
        const zip = new adm_zip_1.default(archiveBuffer);
        const records = extractRecordsFromZip(zip);
        if (!records.length) {
            return { importedFolders: 0, importedDocuments: 0, skipped: [] };
        }
        node_fs_1.default.mkdirSync(targetDir, { recursive: true });
        const plan = yield (0, planLedger_1.getPlan)(prisma, planOwnerKey);
        const writtenFiles = [];
        const skipped = [];
        try {
            const result = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const existingFolders = yield tx.folder.findMany({ where: { ownerId }, select: { id: true, name: true, parentId: true } });
                const folderByName = new Map();
                for (const f of existingFolders) {
                    if (f.parentId === null)
                        folderByName.set(f.name.trim().toLowerCase(), f.id);
                }
                let importedFolders = 0;
                let importedDocuments = 0;
                for (const record of records) {
                    const safeRel = sanitizeZipPath(record.file);
                    const entry = zip.getEntry(safeRel) || zip.getEntries().find(e => !e.isDirectory && e.entryName.replace(/\\/g, '/') === safeRel);
                    if (!entry) {
                        skipped.push({ file: record.file, reason: 'Brak pliku w archiwum ZIP.' });
                        continue;
                    }
                    const ext = node_path_1.default.extname(safeRel).toLowerCase();
                    const mimeType = record.mimeType || MIME_BY_EXT[ext];
                    if (!mimeType || !Object.values(MIME_BY_EXT).includes(mimeType)) {
                        skipped.push({ file: record.file, reason: 'Nieobsługiwany typ pliku.' });
                        continue;
                    }
                    const folderKey = record.folder.trim().toLowerCase();
                    let folderId = folderByName.get(folderKey);
                    if (!folderId) {
                        const createdFolder = yield tx.folder.create({
                            data: { name: record.folder.slice(0, 120), ownerId, parentId: null, order: 0 },
                            select: { id: true },
                        });
                        folderId = createdFolder.id;
                        folderByName.set(folderKey, folderId);
                        importedFolders++;
                    }
                    const fileBytes = entry.getData();
                    const digest = node_crypto_1.default.createHash('sha256').update(fileBytes).digest('hex');
                    try {
                        yield (0, duplicateDocuments_1.assertUniqueDocument)(tx, ownerId, folderId, digest);
                    }
                    catch (err) {
                        if (err instanceof duplicateDocuments_1.DuplicateDocumentError) {
                            skipped.push({ file: record.file, reason: 'Duplikat dokumentu w tej kartotece.' });
                            continue;
                        }
                        throw err;
                    }
                    yield (0, planLedger_1.checkDocumentCapacity)(tx, ownerId, plan, 1);
                    const storedName = `${node_crypto_1.default.randomUUID()}${ext || '.bin'}`;
                    const destPath = node_path_1.default.join(targetDir, storedName);
                    node_fs_1.default.writeFileSync(destPath, fileBytes);
                    writtenFiles.push(destPath);
                    yield tx.document.create({
                        data: {
                            title: record.title.slice(0, 180),
                            filePath: storedName,
                            mimeType,
                            folderId,
                            userId,
                            retentionEnabled: true,
                            retentionValue: (_a = record.retentionValue) !== null && _a !== void 0 ? _a : 5,
                            retentionUnit: (_b = record.retentionUnit) !== null && _b !== void 0 ? _b : 'years',
                        },
                    });
                    importedDocuments++;
                }
                return { importedFolders, importedDocuments };
            }));
            return Object.assign(Object.assign({}, result), { skipped });
        }
        catch (error) {
            for (const file of writtenFiles) {
                node_fs_1.default.rmSync(file, { force: true });
            }
            throw error;
        }
    });
}
