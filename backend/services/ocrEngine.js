"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.extractDocumentText = extractDocumentText;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const canvas_1 = require("@napi-rs/canvas");
const tesseract_js_1 = require("tesseract.js");
const pdfjs = __importStar(require("pdfjs-dist/legacy/build/pdf.mjs"));
function localRecognizer(languageDirectory) {
    return __awaiter(this, void 0, void 0, function* () {
        const directory = languageDirectory || node_path_1.default.join(__dirname, '..', 'ocr-language-data');
        if (!languageDirectory) {
            node_fs_1.default.mkdirSync(directory, { recursive: true });
            for (const code of ['pol', 'eng']) {
                const source = node_path_1.default.join(node_path_1.default.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0', `${code}.traineddata.gz`);
                const target = node_path_1.default.join(directory, `${code}.traineddata.gz`);
                if (!node_fs_1.default.existsSync(target) || node_fs_1.default.statSync(target).size !== node_fs_1.default.statSync(source).size)
                    node_fs_1.default.copyFileSync(source, target);
            }
        }
        for (const lang of ['pol', 'eng'])
            if (!node_fs_1.default.existsSync(node_path_1.default.join(directory, `${lang}.traineddata${languageDirectory ? '' : '.gz'}`)))
                throw new Error(`Brak lokalnego pliku językowego OCR: ${lang}.traineddata.`);
        const worker = yield (0, tesseract_js_1.createWorker)('pol+eng', 1, { langPath: directory, gzip: !languageDirectory, cacheMethod: 'none' });
        return { recognize: (image) => __awaiter(this, void 0, void 0, function* () { return (yield worker.recognize(image)).data.text; }), close: () => __awaiter(this, void 0, void 0, function* () { yield worker.terminate(); }) };
    });
}
/** Extract text on this machine. The document is never sent to a remote service. */
function extractDocumentText(file_1, mimeType_1) {
    return __awaiter(this, arguments, void 0, function* (file, mimeType, options = {}) {
        const recognizerFactory = options.createRecognizer || (() => localRecognizer(options.languageDirectory || process.env.ETECZKA_OCR_LANG_PATH));
        let recognizer;
        const recognize = (image) => __awaiter(this, void 0, void 0, function* () { if (!recognizer)
            recognizer = yield recognizerFactory(); return recognizer.recognize(image); });
        const pdf = mimeType.toLowerCase() === 'application/pdf' || node_path_1.default.extname(file).toLowerCase() === '.pdf';
        try {
            if (!pdf) {
                if (!/^image\/(jpeg|png|bmp|webp|gif)$/i.test(mimeType))
                    throw new Error('Ten format dokumentu nie jest obsługiwany przez OCR.');
                return (yield recognize(node_fs_1.default.readFileSync(file))).trim();
            }
            const bytes = new Uint8Array(node_fs_1.default.readFileSync(file));
            const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
            const document = yield task.promise;
            try {
                const maxPages = options.maxPages || 200;
                if (document.numPages > maxPages)
                    throw new Error(`Dokument przekracza limit ${maxPages} stron OCR.`);
                const pages = [];
                for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
                    const page = yield document.getPage(pageNumber);
                    try {
                        const textContent = yield page.getTextContent();
                        const text = textContent.items.map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('').trim();
                        const operations = yield page.getOperatorList();
                        const hasImage = operations.fnArray.some(op => op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject || op === pdfjs.OPS.paintImageMaskXObject);
                        let ocr = '';
                        if (hasImage || !text) {
                            const original = page.getViewport({ scale: 1 });
                            const scale = Math.min(2, 2400 / Math.max(original.width, original.height));
                            const viewport = page.getViewport({ scale });
                            const canvas = (0, canvas_1.createCanvas)(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
                            const context = canvas.getContext('2d');
                            context.fillStyle = '#ffffff';
                            context.fillRect(0, 0, canvas.width, canvas.height);
                            yield page.render({ canvas: canvas, canvasContext: context, viewport }).promise;
                            ocr = (yield recognize(canvas.toBuffer('image/png'))).trim();
                        }
                        pages.push([text, ocr && !text.includes(ocr) ? ocr : ''].filter(Boolean).join('\n'));
                    }
                    finally {
                        page.cleanup();
                    }
                }
                return pages.join('\n\n').trim();
            }
            finally {
                yield task.destroy();
            }
        }
        finally {
            if (recognizer)
                yield recognizer.close();
        }
    });
}
