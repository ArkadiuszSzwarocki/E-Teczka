import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const toAscii = (value: string) =>
  value
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/Ą/g, 'A').replace(/Ć/g, 'C').replace(/Ę/g, 'E').replace(/Ł/g, 'L')
    .replace(/Ń/g, 'N').replace(/Ó/g, 'O').replace(/Ś/g, 'S').replace(/Ź/g, 'Z').replace(/Ż/g, 'Z')
    .replace(/[^\x20-\x7E]/g, ' ');

function decodeDataUrl(raw: string): { bytes: Uint8Array; isPng: boolean } {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/i.exec(raw.trim());
  if (!match) throw new Error('Dozwolone są wyłącznie obrazy PNG lub JPG.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > 15 * 1024 * 1024) {
    throw new Error('Rozmiar pojedynczego zdjęcia musi wynosić od 1 B do 15 MB.');
  }
  return { bytes: new Uint8Array(bytes), isPng: match[1].toLowerCase() === 'png' };
}

/**
 * Composes front and back photos of an ID card / driving license onto a single A4 page
 * and stamps a diagonal purpose-bound watermark ("KOPIA WYLACZNIE DLA: <recipient> · <date>").
 */
export async function buildIdCardCopyPdf(input: {
  frontDataUrl: string;
  backDataUrl?: string | null;
  recipient: string;
  dateStr?: string;
}): Promise<Uint8Array> {
  const recipient = toAscii(input.recipient.trim() || 'Wskazany odbiorca').slice(0, 60);
  const dateStr = input.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(input.dateStr)
    ? input.dateStr
    : new Date().toISOString().slice(0, 10);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]); // A4 portrait
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText('KOPIA DOKUMENTU TOZSAMOSCI (ZNAK WODNY CELU)', {
    x: 48,
    y: 800,
    size: 13,
    font: fontBold,
    color: rgb(0.15, 0.22, 0.35),
  });
  page.drawText(`Przeznaczenie: ${recipient} | Data: ${dateStr} | Wygenerowano w MojaTeczka`, {
    x: 48,
    y: 782,
    size: 9.5,
    font: fontRegular,
    color: rgb(0.38, 0.43, 0.52),
  });

  const placeImage = async (raw: string, boxY: number, label: string) => {
    const decoded = decodeDataUrl(raw);
    const img = decoded.isPng ? await pdf.embedPng(decoded.bytes) : await pdf.embedJpg(decoded.bytes);
    const maxW = 460;
    const maxH = 290;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const x = (595 - drawW) / 2;
    const y = boxY + (maxH - drawH) / 2;
    page.drawText(label, { x: 68, y: boxY + maxH + 8, size: 9, font: fontBold, color: rgb(0.35, 0.4, 0.48) });
    page.drawRectangle({ x: x - 2, y: y - 2, width: drawW + 4, height: drawH + 4, borderColor: rgb(0.8, 0.84, 0.9), borderWidth: 1 });
    page.drawImage(img, { x, y, width: drawW, height: drawH });
  };

  await placeImage(input.frontDataUrl, 445, 'STRONA 1 (PRZOD)');
  if (input.backDataUrl && input.backDataUrl.trim()) {
    await placeImage(input.backDataUrl, 105, 'STRONA 2 (TYL)');
  }

  const watermarkText = `KOPIA WYLACZNIE DLA: ${recipient.toUpperCase()} - ${dateStr}`;
  for (const yPos of [170, 355, 540, 710]) {
    page.drawText(watermarkText, {
      x: 55,
      y: yPos,
      size: 16,
      font: fontBold,
      color: rgb(0.75, 0.12, 0.12),
      opacity: 0.28,
      rotate: degrees(24),
    });
  }

  return pdf.save();
}
