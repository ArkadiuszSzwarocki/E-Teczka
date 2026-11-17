import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { uploadsDir } from '../config/paths';

/** Combines selected PDF and image documents into a single downloadable PDF buffer. */
export async function exportDocumentsAsPdf(records: Array<{ filePath: string; mimeType: string }>): Promise<Buffer> {
  const output = await PDFDocument.create();
  for (const record of records) {
    const file = fs.readFileSync(path.join(uploadsDir, record.filePath));
    const isPdfBytes = file.subarray(0, 5).toString('ascii') === '%PDF-';
    if (isPdfBytes || record.mimeType.includes('pdf') || record.filePath.toLowerCase().endsWith('.pdf')) {
      const source = await PDFDocument.load(file, { ignoreEncryption: true });
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach(page => output.addPage(page));
      continue;
    }

    const isPng = file.length >= 4 && file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47;
    const isJpg = file.length >= 3 && file[0] === 0xff && file[1] === 0xd8 && file[2] === 0xff;
    let embedded;
    if (isPng) {
      embedded = await output.embedPng(file);
    } else if (isJpg) {
      try { embedded = await output.embedJpg(file); }
      catch {
        const img = await loadImage(file);
        const canvas = createCanvas(img.width, img.height);
        canvas.getContext('2d').drawImage(img, 0, 0);
        embedded = await output.embedPng(canvas.toBuffer('image/png'));
      }
    } else {
      const img = await loadImage(file);
      const canvas = createCanvas(img.width, img.height);
      canvas.getContext('2d').drawImage(img, 0, 0);
      embedded = await output.embedPng(canvas.toBuffer('image/png'));
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
  return Buffer.from(await output.save());
}
