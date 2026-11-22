import { createCanvas, loadImage } from '@napi-rs/canvas';

const MIN_TARGET_LONG_SIDE = 1600;
const MAX_TARGET_LONG_SIDE = 2600;

/**
 * Enhances scanned images and phone photos before Tesseract OCR:
 * - Upscales small images to ~1600px on the long side (capped at 2600px)
 * - Flattens transparency onto a white background
 * - Converts to grayscale and stretches contrast between p2 and p98 percentiles
 * - Applies soft Otsu-guided contrast curve so faint/shadowed text becomes crisp black-on-white
 */
export async function preprocessOcrImage(input: Buffer): Promise<Buffer> {
  try {
    const img = await loadImage(input);
    const srcW = Math.max(1, img.width);
    const srcH = Math.max(1, img.height);
    const longSide = Math.max(srcW, srcH);

    let scale = 1;
    if (longSide < MIN_TARGET_LONG_SIDE) {
      scale = Math.min(2.5, MIN_TARGET_LONG_SIDE / longSide);
    } else if (longSide > MAX_TARGET_LONG_SIDE) {
      scale = MAX_TARGET_LONG_SIDE / longSide;
    }

    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));
    const canvas = createCanvas(dstW, dstH);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dstW, dstH);
    ctx.drawImage(img, 0, 0, dstW, dstH);

    const imageData = ctx.getImageData(0, 0, dstW, dstH);
    const data = imageData.data;
    const totalPixels = dstW * dstH;
    const gray = new Uint8Array(totalPixels);
    const hist = new Uint32Array(256);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      gray[p] = lum;
      hist[lum]++;
    }

    // Find 2nd and 98th percentile luminance for robust contrast stretching
    const lowCut = Math.floor(totalPixels * 0.02);
    const highCut = Math.ceil(totalPixels * 0.98);
    let acc = 0;
    let pLow = 0;
    let pHigh = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= lowCut) { pLow = v; break; }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
      acc += hist[v];
      if (acc >= totalPixels - highCut) { pHigh = v; break; }
    }

    const span = Math.max(16, pHigh - pLow);
    const stretchedHist = new Uint32Array(256);
    for (let p = 0; p < totalPixels; p++) {
      const norm = Math.max(0, Math.min(255, Math.round(((gray[p] - pLow) * 255) / span)));
      gray[p] = norm;
      stretchedHist[norm]++;
    }

    // Compute Otsu threshold on contrast-stretched grayscale to push background toward white
    const threshold = computeOtsuThreshold(stretchedHist, totalPixels);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = gray[p];
      let out = v;
      if (v >= threshold + 18) {
        out = 255;
      } else if (v <= threshold - 28) {
        out = Math.max(0, Math.round(v * 0.45));
      } else {
        // Smooth transition zone preserves anti-aliased glyph edges for Tesseract LSTM
        const t = (v - (threshold - 28)) / 46;
        out = Math.max(0, Math.min(255, Math.round(t * t * 255)));
      }
      data[i] = out;
      data[i + 1] = out;
      data[i + 2] = out;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toBuffer('image/png');
  } catch {
    return input;
  }
}

function computeOtsuThreshold(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 140;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      threshold = i;
    }
  }
  return threshold;
}
