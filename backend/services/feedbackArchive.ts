import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { getArchiveWorkspace, saveArchiveWorkspace } from './archiveWorkspace';
import type { CentralFeedbackItem } from './centralFeedback';
import type { FeedbackThreadMessage } from './feedbackThreadStore';

function toAscii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function wrapLines(text: string, maxChars = 84): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length <= maxChars) {
      out.push(rawLine);
      continue;
    }
    let rest = rawLine;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut < 20) cut = maxChars;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push(rest);
  }
  return out;
}

async function buildBugReportPdf(item: CentralFeedbackItem, messages: FeedbackThreadMessage[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595, 842]);
  let y = 795;

  const drawLine = (text: string, isBold = false, size = 10.5, color = rgb(0.12, 0.16, 0.23)) => {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 795;
    }
    page.drawText(toAscii(text), { x: 45, y, size, font: isBold ? bold : font, color });
    y -= size + 5;
  };

  drawLine(`E-TECZKA - ZGLOSZENIE BLEDU #${item.id} (ZAMKNIETE)`, true, 14, rgb(0.05, 0.25, 0.55));
  y -= 4;
  drawLine(`Temat: ${item.title}`, true, 12);
  drawLine(`Kategoria: ${item.category} | Data: ${new Date(item.createdAt).toLocaleString('pl-PL')}`, false, 10);
  if (item.contactEmail || item.accountEmail) {
    drawLine(`Kontakt: ${item.contactEmail || item.accountEmail}`, false, 10);
  }
  if (item.platform || item.activeView) {
    drawLine(`Srodowisko: ${item.platform || '-'} ${item.appVersion ? `v${item.appVersion}` : ''} | Widok: ${item.activeView || '-'}`, false, 10);
  }
  y -= 8;
  drawLine('Opis zgloszenia:', true, 11);
  for (const line of wrapLines(item.description)) {
    drawLine(line, false, 10);
  }

  if (messages.length > 0) {
    y -= 8;
    drawLine('Historia rozmowy:', true, 11);
    for (const msg of messages) {
      const who = msg.author === 'admin' ? 'Admin' : 'Uzytkownik';
      for (const line of wrapLines(`[${who} ${new Date(msg.createdAt).toLocaleString('pl-PL')}] ${msg.text}`)) {
        drawLine(line, false, 9.5);
      }
    }
  }

  if (item.screenshotDataUrl) {
    const match = item.screenshotDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
    if (match) {
      try {
        const bytes = Buffer.from(match[2], 'base64');
        const img = match[1].toLowerCase() === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const imgPage = pdf.addPage([595, 842]);
        const scale = Math.min(515 / img.width, 720 / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        imgPage.drawText(`Zrzut ekranu do zgloszenia #${item.id}`, { x: 40, y: 800, size: 12, font: bold, color: rgb(0.12, 0.16, 0.23) });
        imgPage.drawImage(img, { x: 40, y: 780 - h, width: w, height: h });
      } catch { /* ignore invalid screenshot image */ }
    }
  }

  return Buffer.from(await pdf.save());
}

/** Saves a closed bug report as a PDF document inside Archive -> BUG folder. */
export async function archiveClosedFeedbackReport(
  prisma: PrismaClient,
  ownerId: number,
  item: CentralFeedbackItem,
  messages: FeedbackThreadMessage[],
): Promise<number> {
  const title = `BUG #${item.id} — ${item.title}`.slice(0, 180);
  const existing = await prisma.document.findFirst({
    where: { title, isArchived: true, isDeleted: false, folder: { ownerId } },
    select: { id: true },
  });
  if (existing) return existing.id;

  let folder = await prisma.folder.findFirst({ where: { ownerId, name: 'BUG' }, select: { id: true } });
  if (!folder) {
    folder = await prisma.folder.findFirst({ where: { ownerId }, select: { id: true } });
  }
  if (!folder) {
    folder = await prisma.folder.create({ data: { name: 'BUG', ownerId, parentId: null, order: 0 }, select: { id: true } });
  }

  const pdfBytes = await buildBugReportPdf(item, messages);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const storedName = `bug-${item.id}-${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(uploadsDir, storedName), pdfBytes);

  const doc = await prisma.document.create({
    data: {
      title,
      filePath: storedName,
      mimeType: 'application/pdf',
      folderId: folder.id,
      userId: ownerId,
      isArchived: true,
      isDeleted: false,
      retentionEnabled: false,
    },
    select: { id: true },
  });

  const workspace = getArchiveWorkspace(ownerId);
  const bugFolder = workspace.folders.find(f => f.name.toUpperCase() === 'BUG');
  const bugFolderId = bugFolder?.id || 'bug';
  if (!bugFolder) {
    workspace.folders.push({ id: bugFolderId, name: 'BUG', parentId: null, icon: '🐛', order: workspace.folders.length });
  }
  workspace.docFolderMap[String(doc.id)] = bugFolderId;
  const currentOrder = workspace.docOrder[bugFolderId] || [];
  if (!currentOrder.includes(doc.id)) {
    workspace.docOrder[bugFolderId] = [doc.id, ...currentOrder];
  }
  saveArchiveWorkspace(ownerId, workspace);
  return doc.id;
}
