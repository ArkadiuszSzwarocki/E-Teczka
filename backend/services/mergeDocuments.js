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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedMergeFormat = void 0;
exports.mergeDocuments = mergeDocuments;
const pdf_lib_1 = require("pdf-lib");
const base64DataUrl_1 = require("./base64DataUrl");
class UnsupportedMergeFormat extends Error {
}
exports.UnsupportedMergeFormat = UnsupportedMergeFormat;
/** Merge PDFs and supported image scans in their original order. */
function mergeDocuments(files) {
    return __awaiter(this, void 0, void 0, function* () {
        const merged = yield pdf_lib_1.PDFDocument.create();
        for (const file of files) {
            const parsed = (0, base64DataUrl_1.parseBase64DataUrl)(file.data);
            if (!parsed)
                throw new UnsupportedMergeFormat('Nieprawidłowe dane pliku.');
            const bytes = Uint8Array.from(Buffer.from(parsed.base64, 'base64'));
            if (parsed.mimeType === 'application/pdf') {
                const source = yield pdf_lib_1.PDFDocument.load(bytes);
                for (const page of yield merged.copyPages(source, source.getPageIndices()))
                    merged.addPage(page);
            }
            else if (parsed.mimeType === 'image/jpeg' || parsed.mimeType === 'image/png') {
                const image = parsed.mimeType === 'image/png' ? yield merged.embedPng(bytes) : yield merged.embedJpg(bytes);
                const page = merged.addPage([image.width, image.height]);
                page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
            }
            else
                throw new UnsupportedMergeFormat('Scalanie obsługuje pliki PDF, JPEG i PNG.');
        }
        return merged.save();
    });
}
