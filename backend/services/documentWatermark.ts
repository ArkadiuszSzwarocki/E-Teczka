import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const APP_NAME = 'E-Teczka';

function resolveLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../assets/icon.png'),
    path.join(process.cwd(), 'assets', 'icon.png'),
    path.join(process.cwd(), '..', 'assets', 'icon.png'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

async function createWatermarkStampPng(ownerEmail: string): Promise<Buffer> {
  const label = ownerEmail.trim() || 'Właściciel E-Teczki';
  const width = 560;
  const height = 110;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  const logoPath = resolveLogoPath();
  let textStartX = 24;
  if (logoPath) {
    try {
      const logo = await loadImage(fs.readFileSync(logoPath));
      const logoSize = 64;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(logo, 20, (height - logoSize) / 2, logoSize, logoSize);
      ctx.globalAlpha = 1;
      textStartX = 98;
    } catch {
      // Proceed with text-only watermark if logo cannot be decoded
    }
  }

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(APP_NAME, textStartX, 46);

  ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
  ctx.font = '600 18px sans-serif';
  ctx.fillText(label, textStartX, 78, width - textStartX - 16);

  return canvas.toBuffer('image/png');
}

/** Stamps a semi-transparent E-Teczka logo, app name, and owner email watermark onto every PDF page. */
export async function applyWatermarkToPdf(pdfBytes: Buffer, ownerEmail: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const stampPng = await createWatermarkStampPng(ownerEmail);
  const embedded = await doc.embedPng(stampPng);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const diagW = Math.min(width * 0.68, 420);
    const diagH = (embedded.height / embedded.width) * diagW;

    page.drawImage(embedded, {
      x: (width - diagW) / 2 + 20,
      y: (height - diagH) / 2 - 40,
      width: diagW,
      height: diagH,
      rotate: degrees(28),
      opacity: 0.22,
    });

    const footerW = Math.min(width * 0.38, 220);
    const footerH = (embedded.height / embedded.width) * footerW;
    page.drawImage(embedded, {
      x: Math.max(12, width - footerW - 14),
      y: 12,
      width: footerW,
      height: footerH,
      opacity: 0.35,
    });
  }

  return Buffer.from(await doc.save());
}

/** Stamps a semi-transparent E-Teczka logo, app name, and owner email watermark onto a PNG/JPEG image. */
export async function applyWatermarkToImage(imageBytes: Buffer, mimeType: string, ownerEmail: string): Promise<Buffer> {
  const baseImage = await loadImage(imageBytes);
  const stampImage = await loadImage(await createWatermarkStampPng(ownerEmail));

  const canvas = createCanvas(baseImage.width, baseImage.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baseImage, 0, 0);

  const diagW = Math.min(baseImage.width * 0.65, 640);
  const diagH = (stampImage.height / stampImage.width) * diagW;
  ctx.save();
  ctx.translate(baseImage.width / 2, baseImage.height / 2);
  ctx.rotate((-28 * Math.PI) / 180);
  ctx.globalAlpha = 0.24;
  ctx.drawImage(stampImage, -diagW / 2, -diagH / 2, diagW, diagH);
  ctx.restore();

  const footerW = Math.min(baseImage.width * 0.35, 320);
  const footerH = (stampImage.height / stampImage.width) * footerW;
  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.drawImage(stampImage, Math.max(12, baseImage.width - footerW - 16), Math.max(12, baseImage.height - footerH - 12), footerW, footerH);
  ctx.restore();

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return canvas.toBuffer('image/jpeg', 90);
  }
  return canvas.toBuffer('image/png');
}

/** Applies the E-Teczka watermark to either a PDF or supported image buffer. */
export async function applyWatermarkToDocument(bytes: Buffer, mimeType: string, ownerEmail: string): Promise<Buffer> {
  const isPdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-' || mimeType.includes('pdf');
  if (isPdf) return applyWatermarkToPdf(bytes, ownerEmail);
  return applyWatermarkToImage(bytes, mimeType, ownerEmail);
}
