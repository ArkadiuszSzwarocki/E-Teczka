import { PDFDocument } from 'pdf-lib';
import { parseBase64DataUrl } from './base64DataUrl';

export type MergeSource = { data: string };
export class UnsupportedMergeFormat extends Error {}

/** Merge PDFs and supported image scans in their original order. */
export async function mergeDocuments(files: MergeSource[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const file of files) {
    const parsed = parseBase64DataUrl(file.data);
    if (!parsed) throw new UnsupportedMergeFormat('Nieprawidłowe dane pliku.');
    const bytes = Uint8Array.from(Buffer.from(parsed.base64, 'base64'));
    if (parsed.mimeType === 'application/pdf') {
      const source = await PDFDocument.load(bytes);
      for (const page of await merged.copyPages(source, source.getPageIndices())) merged.addPage(page);
    } else if (parsed.mimeType === 'image/jpeg' || parsed.mimeType === 'image/png') {
      const image = parsed.mimeType === 'image/png' ? await merged.embedPng(bytes) : await merged.embedJpg(bytes);
      const page = merged.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    } else throw new UnsupportedMergeFormat('Scalanie obsługuje pliki PDF, JPEG i PNG.');
  }
  return merged.save();
}
