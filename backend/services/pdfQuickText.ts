import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

type TextItem = { str?: string; hasEOL?: boolean };

/** Extracts text from the first few pages of a PDF buffer in memory for fast classification. */
export async function extractQuickPdfText(buffer: Buffer, maxPages = 2): Promise<string> {
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | null = null;
  try {
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0,
    });
    doc = await task.promise;
    const pages = Math.min(doc.numPages || 0, maxPages);
    const chunks: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = (content.items as TextItem[])
        .map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`)
        .join('')
        .trim();
      if (line) chunks.push(line);
    }
    return chunks.join('\n').slice(0, 15_000);
  } catch {
    return '';
  } finally {
    if (doc) await doc.cleanup().catch(() => undefined);
  }
}
