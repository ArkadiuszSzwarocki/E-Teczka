import type { PrismaClient } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAccessibleFolderIds } from './familyAccess';

const toAsciiPolish = (text: string) =>
  text
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
    .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/Ą/g, 'A').replace(/Ć/g, 'C').replace(/Ę/g, 'E').replace(/Ł/g, 'L')
    .replace(/Ń/g, 'N').replace(/Ó/g, 'O').replace(/Ś/g, 'S').replace(/Ź/g, 'Z').replace(/Ż/g, 'Z')
    .replace(/[^\x20-\x7E]/g, ' ');

/**
 * Generates a printable "Teczka Awaryjna Rodziny" (Family Emergency Kit) PDF
 * listing critical policies, loans, deeds, physical locations, and recovery instructions.
 */
export async function buildFamilyEmergencyKitPdf(
  prisma: PrismaClient,
  ownerId: number,
  emergencyContacts = '',
): Promise<Uint8Array> {
  const accessibleIds = await getAccessibleFolderIds(prisma, ownerId);
  const allDocs = await prisma.document.findMany({
    where: {
      isDeleted: false,
      OR: [{ userId: ownerId }, { folderId: { in: accessibleIds } }],
    },
    include: {
      folder: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const taggedEmergency = allDocs.filter(doc =>
    doc.tags.some(t => /awaryjn|emergency|pilne|wazne/i.test(t.tag.name)),
  );
  const autoCritical = allDocs.filter(doc =>
    /polisa|oc|ac|ubezpiecz|kredyt|hipotek|akt\s+notarial|testament|paszport|dow[óo]d|spadek/i.test(
      `${doc.title} ${doc.folder?.name || ''}`,
    ),
  );
  const selected = taggedEmergency.length > 0 ? taggedEmergency : autoCritical.slice(0, 40);

  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595, 842]);
  let y = 795;
  const ensureSpace = (needed: number) => {
    if (y - needed < 50) {
      page = pdf.addPage([595, 842]);
      y = 795;
    }
  };

  page.drawText('MOJATECZKA - TECZKA AWARYJNA RODZINY', { x: 45, y, size: 17, font: fontBold, color: rgb(0.1, 0.25, 0.55) });
  y -= 20;
  page.drawText(`Wygenerowano: ${new Date().toISOString().slice(0, 10)} | Dokumentow krytycznych: ${selected.length}`, { x: 45, y, size: 10, font: fontRegular, color: rgb(0.35, 0.4, 0.5) });
  y -= 24;

  page.drawText('1. Instrukcja odzyskania dostepu w sytuacji awaryjnej', { x: 45, y, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
  y -= 16;
  const instructions = [
    '- Oryginaly skanow znajduja sie w aplikacji MojaTeczka (komputer + kopia zaszyfrowana).',
    '- Aby odtworzyc zaszyfrowana kopie na nowym komputerze, uzyj pliku Klucza Odzyskiwania (.json).',
    '- Telefony alarmowe: 112 (Ratunkowy), 999 (Pogotowie), 998 (Straz), 997 (Policja).',
  ];
  for (const line of instructions) {
    page.drawText(line, { x: 50, y, size: 9.5, font: fontRegular, color: rgb(0.2, 0.25, 0.3) });
    y -= 14;
  }

  if (emergencyContacts.trim()) {
    y -= 6;
    page.drawText('Kontakty rodzinne / notatki:', { x: 50, y, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
    y -= 14;
    for (const rawLine of emergencyContacts.trim().split(/\r?\n/).slice(0, 8)) {
      ensureSpace(16);
      page.drawText(toAsciiPolish(rawLine).slice(0, 95), { x: 54, y, size: 9.5, font: fontRegular, color: rgb(0.15, 0.2, 0.25) });
      y -= 14;
    }
  }

  y -= 14;
  page.drawText('2. Wykaz dokumentow krytycznych (tag "Awaryjne" / polisy / kredyty / akty)', { x: 45, y, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
  y -= 18;

  if (selected.length === 0) {
    page.drawText('Brak oznaczonych dokumentow. Dodaj tag "Awaryjne" do kluczowych polis, kredytow i aktow.', { x: 50, y, size: 10, font: fontRegular, color: rgb(0.4, 0.4, 0.45) });
  } else {
    selected.forEach((doc, idx) => {
      ensureSpace(34);
      const dueStr = doc.dueDate ? ` | Termin: ${doc.dueDate.toISOString().slice(0, 10)}` : '';
      const locStr = doc.physicalLocation ? ` | Miejsce: ${toAsciiPolish(doc.physicalLocation)}` : '';
      const header = `${idx + 1}. ${toAsciiPolish(doc.title).slice(0, 78)}`;
      const meta = `   Kartoteka: ${toAsciiPolish(doc.folder?.name || 'Glowna')}${dueStr}${locStr}`.slice(0, 105);
      page.drawText(header, { x: 48, y, size: 10, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
      y -= 13;
      page.drawText(meta, { x: 48, y, size: 8.8, font: fontRegular, color: rgb(0.35, 0.4, 0.45) });
      y -= 16;
    });
  }

  return pdf.save();
}
