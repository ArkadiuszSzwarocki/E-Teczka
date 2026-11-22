import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import * as archiver from 'archiver';
import { uploadsDir } from '../config/paths';
import { getAccessibleFolderIds } from './familyAccess';

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Builds a ZIP archive containing matching documents and a semicolon-separated CSV accounting summary. */
export async function createAccountantZipArchive(
  prisma: PrismaClient,
  ownerId: number,
  month?: string,
) {
  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  const validMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : null;

  let dateFilter: { gte?: Date; lt?: Date } | undefined;
  if (validMonth) {
    const [year, mon] = validMonth.split('-').map(Number);
    dateFilter = {
      gte: new Date(year, mon - 1, 1),
      lt: new Date(year, mon, 1),
    };
  }

  const documents = await prisma.document.findMany({
    where: {
      folderId: { in: accessibleIds },
      isDeleted: false,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    },
    include: { folder: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const rows = [
    ['ID', 'Tytul', 'Kartoteka', 'Data dodania', 'Sprzedawca', 'Kwota', 'Waluta', 'Termin platnosci', 'Status platnosci'].join(';'),
  ];

  const archive = new (archiver as unknown as { ZipArchive: new (opts: object) => NodeJS.ReadableStream & { append: (src: unknown, data: { name: string }) => void; finalize: () => Promise<void> } }).ZipArchive({ zlib: { level: 6 } });
  const usedNames = new Set<string>();

  for (const doc of documents) {
    const amount = typeof doc.amountCents === 'number' ? (doc.amountCents / 100).toFixed(2).replace('.', ',') : '';
    rows.push([
      csvCell(doc.id),
      csvCell(doc.title),
      csvCell(doc.folder?.name || ''),
      csvCell(doc.createdAt.toISOString().slice(0, 10)),
      csvCell(doc.merchantName || ''),
      csvCell(amount),
      csvCell(doc.currency || 'PLN'),
      csvCell(doc.dueDate ? doc.dueDate.toISOString().slice(0, 10) : ''),
      csvCell(doc.paymentStatus || ''),
    ].join(';'));

    const rel = doc.filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const fileNameOnDisk = path.basename(rel);
    const diskPath = path.join(uploadsDir, fileNameOnDisk);
    if (!fs.existsSync(diskPath)) continue;

    const ext = path.extname(fileNameOnDisk) || '.pdf';
    const base = doc.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || `dokument_${doc.id}`;
    let zipName = base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
    let idx = 2;
    while (usedNames.has(zipName.toLowerCase())) {
      zipName = `${base}_${idx}${ext}`;
      idx++;
    }
    usedNames.add(zipName.toLowerCase());
    archive.append(fs.createReadStream(diskPath), { name: `dokumenty/${zipName}` });
  }

  const csvBuffer = Buffer.from(`\uFEFF${rows.join('\r\n')}`, 'utf8');
  archive.append(csvBuffer, { name: 'zestawienie_ksiegowe.csv' });

  return { archive, count: documents.length, label: validMonth || 'wszystkie' };
}
