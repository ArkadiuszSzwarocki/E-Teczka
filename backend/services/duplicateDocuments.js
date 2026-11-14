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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashBuffer = exports.DuplicateDocumentError = void 0;
exports.hashFile = hashFile;
exports.assertUniqueDocument = assertUniqueDocument;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("../config/paths");
class DuplicateDocumentError extends Error {
    constructor(existingTitle) {
        super(`Ten plik znajduje się już w tej kartotece: „${existingTitle}”.`);
        this.existingTitle = existingTitle;
        this.code = 'DUPLICATE_DOCUMENT';
    }
}
exports.DuplicateDocumentError = DuplicateDocumentError;
const hashBuffer = (data) => (0, crypto_1.createHash)('sha256').update(data).digest('hex');
exports.hashBuffer = hashBuffer;
function hashFile(filename) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        const hash = (0, crypto_1.createHash)('sha256');
        try {
            for (var _d = true, _e = __asyncValues(fs_1.default.createReadStream(filename)), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                const chunk = _c;
                hash.update(chunk);
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return hash.digest('hex');
    });
}
/** Compare stored bytes, scoped to an owned folder, including archive and trash. */
function assertUniqueDocument(db, ownerId, folderId, digest, excludeId) {
    return __awaiter(this, void 0, void 0, function* () {
        const records = yield db.document.findMany({ where: Object.assign({ folderId, folder: { ownerId } }, (excludeId === undefined ? {} : { id: { not: excludeId } })), select: { filePath: true, title: true } });
        for (const record of records) {
            if (!record.filePath || path_1.default.basename(record.filePath) !== record.filePath)
                throw new Error('Nie można sprawdzić istniejącego pliku w kartotece.');
            let existing;
            try {
                existing = yield hashFile(path_1.default.join(paths_1.uploadsDir, record.filePath));
            }
            catch (_a) {
                throw new Error('Nie można sprawdzić istniejącego pliku w kartotece.');
            }
            if (existing === digest)
                throw new DuplicateDocumentError(record.title);
        }
    });
}
