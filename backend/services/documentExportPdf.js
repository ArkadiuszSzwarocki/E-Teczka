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
exports.exportDocumentsAsPdf = exportDocumentsAsPdf;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const pdf_lib_1 = require("pdf-lib");
const canvas_1 = require("@napi-rs/canvas");
const paths_1 = require("../config/paths");
/** Combines selected PDF and image documents into a single downloadable PDF buffer. */
function exportDocumentsAsPdf(records) {
    return __awaiter(this, void 0, void 0, function* () {
        const output = yield pdf_lib_1.PDFDocument.create();
        for (const record of records) {
            const file = node_fs_1.default.readFileSync(node_path_1.default.join(paths_1.uploadsDir, record.filePath));
            const isPdfBytes = file.subarray(0, 5).toString('ascii') === '%PDF-';
            if (isPdfBytes || record.mimeType.includes('pdf') || record.filePath.toLowerCase().endsWith('.pdf')) {
                const source = yield pdf_lib_1.PDFDocument.load(file, { ignoreEncryption: true });
                const pages = yield output.copyPages(source, source.getPageIndices());
                pages.forEach(page => output.addPage(page));
                continue;
            }
            const isPng = file.length >= 4 && file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47;
            const isJpg = file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
            let embedded;
            if (isPng) {
                embedded = yield output.embedPng(file);
            }
            else if (isJpg) {
                try {
                    embedded = yield output.embedJpg(file);
                }
                catch (_a) {
                    const img = yield (0, canvas_1.loadImage)(file);
                    const canvas = (0, canvas_1.createCanvas)(img.width, img.height);
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    embedded = yield output.embedPng(canvas.toBuffer('image/png'));
                }
            }
            else {
                const img = yield (0, canvas_1.loadImage)(file);
                const canvas = (0, canvas_1.createCanvas)(img.width, img.height);
                canvas.getContext('2d').drawImage(img, 0, 0);
                embedded = yield output.embedPng(canvas.toBuffer('image/png'));
            }
            const [a4W, a4H] = [595.28, 841.89];
            const [pageW, pageH] = embedded.width > embedded.height ? [a4H, a4W] : [a4W, a4H];
            const margin = 24;
            const scale = Math.min((pageW - margin * 2) / embedded.width, (pageH - margin * 2) / embedded.height);
            const drawW = embedded.width * scale;
            const drawH = embedded.height * scale;
            const page = output.addPage([pageW, pageH]);
            page.drawImage(embedded, { x: (pageW - drawW) / 2, y: (pageH - drawH) / 2, width: drawW, height: drawH });
        }
        return Buffer.from(yield output.save());
    });
}
