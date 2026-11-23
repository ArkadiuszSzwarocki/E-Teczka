import type { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { collectFolderBranch } from './folders';

const toAscii = (value: string) =>
  value
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/Ą/g, 'A').replace(/Ć/g, 'C').replace(/Ę/g, 'E').replace(/Ł/g, 'L')
    .replace(/Ń/g, 'N').replace(/Ó/g, 'O').replace(/Ś/g, 'S').replace(/Ź/g, 'Z').replace(/Ż/g, 'Z')
    .replace(/[^\x20-\x7E]/g, ' ');

/**
 * Generates an anonymized PDF history report ("Ksiazka serwisowa auta / Teczka mieszkania")
 * summarizing all invoices, receipts, and total maintenance cost inside a folder branch.
 */
export async function buildFolderHistoryPdf(
  prisma: PrismaClient,
  ownerId: number,
  folderId: number,
): Promise<{ bytes: Uint8Array; folderName: string }> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId }, select: { id: true, name: true } });
  if (!folder) throw new Error('Nie znaleziono kartoteki.');

  const branchIds = await collectFolderBranch(prisma, folderId, ownerId);
  const docs = await prisma.document.findMany({
    where: { folderId: { in: branchIds.length ? branchIds : [folderId] }, isDeleted: false },
    include: { folder: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const totalPlnCents = docs
    .filter(d => typeof d.amountCents === 'number' && (d.currency || 'PLN').toUpperCase() === 'PLN')
    .reduce((sum, d) => sum + Number(d.amountCents || 0), 0);

  const pdf = await PDFDocument.create();
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);

  let page = pdf.addPage([595, 842]);
  let y = 795;
  const ensureSpace = (needed: number) => {
    if (y - needed < 50) {
      page = pdf.addPage([595, 842]);
      y = 795;
    }
  };

  page.drawText(`MOJATECZKA - RAPORT HISTORII: ${toAscii(folder.name).toUpperCase().slice(0, 42)}`, {
    x: 45,
    y,
    size: 14,
    font: fontBold,
    color: rgb(0.1, 0.25, 0.55),
  });
  y -= 20;
  page.drawText(
    `Data raportu: ${new Date().toISOString().slice(0, 10)} | Dokumentow: ${docs.length} | Laczny koszt (PLN): ${(totalPlnCents / 100).toFixed(2)} PLN`,
    { x: 45, y, size: 9.5, font: fontRegular, color: rgb(0.35, 0.4, 0.5) },
  );
  y -= 14;
  page.drawText('Raport zanonimizowany (bez prywatnych danych osobowych wlasciciela) - gotowy do przekazania przy sprzedazy.', {
    x: 45,
    y,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.45, 0.5, 0.58),
  });
  y -= 24;

  if (docs.length === 0) {
    page.drawText('Brak dokumentow w tej kartotece.', { x: 45, y, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.45) });
  } else {
    docs.forEach((doc, idx) => {
      ensureSpace(32);
      const dateStr = doc.createdAt.toISOString().slice(0, 10);
      const amountStr = typeof doc.amountCents === 'number'
        ? `${(doc.amountCents / 100).toFixed(2)} ${doc.currency || 'PLN'}`
        : '—';
      const merchant = doc.merchantName ? ` | ${toAscii(doc.merchantName).slice(0, 28)}` : '';
      page.drawText(`${idx + 1}. [${dateStr}] ${toAscii(doc.title).slice(0, 62)}`, {
        x: 45,
        y,
        size: 9.5,
        font: fontBold,
        color: rgb(0.1, 0.15, 0.25),
      });
      y -= 13;
      page.drawText(`   Podkartoteka: ${toAscii(doc.folder?.name || folder.name).slice(0, 28)}${merchant} | Kwota: ${amountStr}`, {
        x: 45,
        y,
        size: 8.5,
        font: fontRegular,
        color: rgb(0.35, 0.4, 0.48),
      });
      y -= 16;
    });
  }

  return { bytes: await pdf.save(), folderName: folder.name };
}
