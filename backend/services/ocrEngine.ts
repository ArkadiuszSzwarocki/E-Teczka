import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { dataRoot } from '../config/paths';
import { preprocessOcrImage } from './ocrPreprocess';

type TextItem = { str?: string; hasEOL?: boolean };
type Recognizer = { recognize: (input: Buffer) => Promise<string>; close: () => Promise<void> };
type OcrOptions = { languageDirectory?: string; createRecognizer?: () => Promise<Recognizer>; maxPages?: number };

async function localRecognizer(languageDirectory?: string): Promise<Recognizer> {
  const directory = languageDirectory || path.join(dataRoot, 'ocr-language-data');
  if (!languageDirectory) {
    fs.mkdirSync(directory, { recursive: true });
    for (const code of ['pol', 'eng']) {
      const source = path.join(path.dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)), '4.0.0', `${code}.traineddata.gz`);
      const target = path.join(directory, `${code}.traineddata.gz`);
      if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size) fs.copyFileSync(source, target);
    }
  }
  for (const lang of ['pol', 'eng']) if (!fs.existsSync(path.join(directory, `${lang}.traineddata${languageDirectory ? '' : '.gz'}`))) throw new Error(`Brak lokalnego pliku językowego OCR: ${lang}.traineddata.`);
  const worker = await createWorker('pol+eng', 1, { langPath: directory, gzip: !languageDirectory, cacheMethod: 'none' });
  return { recognize: async image => (await worker.recognize(image)).data.text, close: async () => { await worker.terminate(); } };
}

/** Extract text on this machine. The document is never sent to a remote service. */
export async function extractDocumentText(file: string, mimeType: string, options: OcrOptions = {}): Promise<string> {
  const recognizerFactory = options.createRecognizer || (() => localRecognizer(options.languageDirectory || process.env.ETECZKA_OCR_LANG_PATH));
  let recognizer: Recognizer | undefined;
  const recognize = async (image: Buffer) => {
    if (!recognizer) recognizer = await recognizerFactory();
    const prepared = await preprocessOcrImage(image);
    return recognizer.recognize(prepared);
  };
  const pdf = mimeType.toLowerCase() === 'application/pdf' || path.extname(file).toLowerCase() === '.pdf';
  try {
    if (!pdf) {
      if (!/^image\/(jpeg|png|bmp|webp|gif)$/i.test(mimeType)) throw new Error('Ten format dokumentu nie jest obsługiwany przez OCR.');
      return (await recognize(fs.readFileSync(file))).trim();
    }
    const bytes = new Uint8Array(fs.readFileSync(file));
    const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
    const document = await task.promise;
    try {
      const maxPages = options.maxPages || 200;
      if (document.numPages > maxPages) throw new Error(`Dokument przekracza limit ${maxPages} stron OCR.`);
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        try {
          const textContent = await page.getTextContent();
          const text = (textContent.items as TextItem[]).map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('').trim();
          const operations = await page.getOperatorList();
          const hasImage = operations.fnArray.some(op => op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject || op === pdfjs.OPS.paintImageMaskXObject);
          let ocr = '';
          // Only run expensive Tesseract OCR on PDF pages that lack sufficient vector text (e.g. scanned pages).
          if ((hasImage && text.length < 40) || !text) {
            const original = page.getViewport({ scale: 1 });
            const scale = Math.min(2, 2400 / Math.max(original.width, original.height));
            const viewport = page.getViewport({ scale });
            const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
            const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
            ocr = (await recognize(canvas.toBuffer('image/png'))).trim();
          }
          pages.push([text, ocr && !text.includes(ocr) ? ocr : ''].filter(Boolean).join('\n'));
        } finally { page.cleanup(); }
      }
      return pages.join('\n\n').trim();
    } finally { await task.destroy(); }
  } finally { if (recognizer) await recognizer.close(); }
}
