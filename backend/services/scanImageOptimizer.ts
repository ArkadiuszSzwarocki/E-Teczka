import { createCanvas, loadImage } from '@napi-rs/canvas';

export type OptimizeImageOptions = {
  maxWidth?: number;
  maxHeight?: number;
  grayscale?: boolean;
  quality?: number;
};

/**
 * Normalizes scanned images (WebP/JPEG/PNG) before PDF embedding:
 * downscales to OCR-optimal bounds (1200x1920) and optionally converts to high-contrast grayscale JPEG.
 */
export async function optimizeScanImageForPdf(bytes: Buffer, options: OptimizeImageOptions = {}): Promise<Buffer> {
  const maxWidth = options.maxWidth ?? 1200;
  const maxHeight = options.maxHeight ?? 1920;
  const grayscale = options.grayscale !== false;
  const quality = options.quality ?? 72;

  const img = await loadImage(bytes);
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));

  const canvas = createCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, targetW, targetH);

  if (grayscale) {
    const frame = ctx.getImageData(0, 0, targetW, targetH);
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Subtle contrast stretch for sharper OCR text and cleaner white margins.
      const contrasted = Math.max(0, Math.min(255, Math.round((luma - 128) * 1.18 + 132)));
      data[i] = contrasted;
      data[i + 1] = contrasted;
      data[i + 2] = contrasted;
    }
    ctx.putImageData(frame, 0, 0);
  }

  return canvas.toBuffer('image/jpeg', quality);
}
