import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { uploadsDir } from '../config/paths';

export type RodoExportRegion = {
  x: number;
  y: number;
  w: number;
  h: number;
  page?: number;
};

function applyMosaicToCanvas(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  width: number,
  height: number,
  regions: RodoExportRegion[],
) {
  for (const r of regions) {
    const rx = Math.max(0, Math.floor((r.x / 100) * width));
    const ry = Math.max(0, Math.floor((r.y / 100) * height));
    const rw = Math.max(4, Math.min(width - rx, Math.ceil((r.w / 100) * width)));
    const rh = Math.max(4, Math.min(height - ry, Math.ceil((r.h / 100) * height)));
    const cell = Math.max(8, Math.round(Math.min(rw, rh) / 4));
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    const data = imgData.data;

    for (let by = 0; by < rh; by += cell) {
      for (let bx = 0; bx < rw; bx += cell) {
        const bw = Math.min(cell, rw - bx);
        const bh = Math.min(cell, rh - by);
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let count = 0;
        for (let py = 0; py < bh; py++) {
          for (let px = 0; px < bw; px++) {
            const idx = ((by + py) * rw + (bx + px)) * 4;
            sr += data[idx];
            sg += data[idx + 1];
            sb += data[idx + 2];
            count++;
          }
        }
        const ar = Math.round(sr / Math.max(1, count));
        const ag = Math.round(sg / Math.max(1, count));
        const ab = Math.round(sb / Math.max(1, count));
        for (let py = 0; py < bh; py++) {
          for (let px = 0; px < bw; px++) {
            const idx = ((by + py) * rw + (bx + px)) * 4;
            data[idx] = ar;
            data[idx + 1] = ag;
            data[idx + 2] = ab;
            data[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imgData, rx, ry);
  }
}

/**
 * Exports a PDF with RODO regions permanently rasterized and pixelated into the page pixels
 * so hidden text cannot be selected or recovered underneath.
 */
export async function exportPdfWithRodoRegions(
  relativeFilePath: string,
  regions: RodoExportRegion[],
): Promise<Uint8Array> {
  const fullPath = path.resolve(uploadsDir, path.basename(relativeFilePath));
  const bytes = new Uint8Array(fs.readFileSync(fullPath));
  const srcPdf = await PDFDocument.load(bytes);
  const outPdf = await PDFDocument.create();

  const regionsByPage = new Map<number, RodoExportRegion[]>();
  for (const reg of regions) {
    const p = Math.max(1, Math.round(reg.page ?? 1));
    const arr = regionsByPage.get(p) || [];
    arr.push(reg);
    regionsByPage.set(p, arr);
  }

  const pdfTask = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const pdfDoc = await pdfTask.promise;
  try {
    const total = srcPdf.getPageCount();
    for (let pageNum = 1; pageNum <= total; pageNum++) {
      const pageRegions = regionsByPage.get(pageNum);
      if (!pageRegions || pageRegions.length === 0) {
        const [copied] = await outPdf.copyPages(srcPdf, [pageNum - 1]);
        outPdf.addPage(copied);
        continue;
      }

      const page = await pdfDoc.getPage(pageNum);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 2 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        applyMosaicToCanvas(ctx, canvas.width, canvas.height, pageRegions);
        const png = canvas.toBuffer('image/png');
        const embedded = await outPdf.embedPng(png);
        const outPage = outPdf.addPage([base.width, base.height]);
        outPage.drawImage(embedded, { x: 0, y: 0, width: base.width, height: base.height });
      } finally {
        page.cleanup();
      }
    }
    return await outPdf.save();
  } finally {
    await pdfTask.destroy();
  }
}
