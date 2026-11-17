import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { checkDocumentCapacity, getPlan } from './planLedger';
import { assertUniqueDocument, DuplicateDocumentError } from './duplicateDocuments';

export type ExternalImportRecord = {
  folder: string;
  title: string;
  file: string;
  mimeType?: string;
  retentionValue?: number;
  retentionUnit?: 'days' | 'months' | 'years';
};

export type ExternalImportResult = {
  importedFolders: number;
  importedDocuments: number;
  skipped: Array<{ file: string; reason: string }>;
};

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function sanitizeZipPath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || path.isAbsolute(normalized)) {
    throw new Error(`Nieprawidłowa ścieżka w archiwum: ${raw}`);
  }
  return normalized;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvRecords(csvText: string): ExternalImportRecord[] {
  const clean = csvText.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const headers = splitCsvLine(lines[0], delimiter).map(h => h.toLowerCase().trim());

  const findCol = (candidates: string[]) => headers.findIndex(h => candidates.includes(h));
  const colFolder = findCol(['folder', 'kartoteka', 'category', 'kategoria']);
  const colTitle = findCol(['title', 'tytul', 'tytuł', 'name', 'nazwa']);
  const colFile = findCol(['file', 'filepath', 'plik', 'filename', 'path']);
  const colMime = findCol(['mimetype', 'mime', 'type', 'typ']);
  const colRetVal = findCol(['retentionvalue', 'retention', 'retencja']);
  const colRetUnit = findCol(['retentionunit', 'unit', 'jednostka']);

  if (colFile < 0) throw new Error('Plik CSV musi zawierać kolumnę „file” (lub „plik”).');

  const records: ExternalImportRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const file = cells[colFile] || '';
    if (!file) continue;
    const rawUnit = colRetUnit >= 0 ? (cells[colRetUnit] || '').toLowerCase() : '';
    const retentionUnit = rawUnit === 'days' || rawUnit === 'months' || rawUnit === 'years' ? rawUnit : undefined;
    const rawVal = colRetVal >= 0 ? Number(cells[colRetVal]) : NaN;
    records.push({
      folder: (colFolder >= 0 && cells[colFolder]) ? cells[colFolder] : 'Importowane',
      title: (colTitle >= 0 && cells[colTitle]) ? cells[colTitle] : path.basename(file, path.extname(file)),
      file,
      mimeType: colMime >= 0 ? cells[colMime] || undefined : undefined,
      retentionValue: Number.isInteger(rawVal) && rawVal > 0 ? rawVal : undefined,
      retentionUnit,
    });
  }
  return records;
}

function parseJsonRecords(jsonText: string): ExternalImportRecord[] {
  const parsed = JSON.parse(jsonText) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { documents?: unknown }).documents))
      ? (parsed as { documents: unknown[] }).documents
      : null;
  if (!rows) throw new Error('Plik JSON musi zawierać tablicę dokumentów lub pole „documents”.');

  return rows
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => {
      const file = String(item.file || item.filePath || item.plik || item.filename || '').trim();
      const folder = String(item.folder || item.kartoteka || item.category || 'Importowane').trim() || 'Importowane';
      const title = String(item.title || item.tytul || item.name || path.basename(file, path.extname(file))).trim() || 'Dokument';
      const unit = String(item.retentionUnit || '').toLowerCase();
      const retentionUnit: 'days' | 'months' | 'years' | undefined =
        unit === 'days' || unit === 'months' || unit === 'years' ? unit : undefined;
      return {
        folder,
        title,
        file,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
        retentionValue: typeof item.retentionValue === 'number' && item.retentionValue > 0 ? Math.round(item.retentionValue) : undefined,
        retentionUnit,
      };
    })
    .filter(item => Boolean(item.file));
}

function extractRecordsFromZip(zip: AdmZip): ExternalImportRecord[] {
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const jsonEntry = entries.find(e => /^(index|documents|metadata)\.json$/i.test(path.basename(e.entryName)))
    || entries.find(e => e.entryName.toLowerCase().endsWith('.json') && path.basename(e.entryName).toLowerCase() !== 'manifest.json');
  if (jsonEntry) {
    return parseJsonRecords(jsonEntry.getData().toString('utf8'));
  }
  const csvEntry = entries.find(e => /^(index|documents|metadata)\.csv$/i.test(path.basename(e.entryName)))
    || entries.find(e => e.entryName.toLowerCase().endsWith('.csv'));
  if (csvEntry) {
    return parseCsvRecords(csvEntry.getData().toString('utf8'));
  }
  throw new Error('Archiwum ZIP musi zawierać plik metadanych CSV lub JSON (np. index.csv lub index.json).');
}

/** Imports an external ZIP package (CSV/JSON metadata + binary files) into SQLite and uploadsDir. */
export async function importExternalArchive(
  prisma: PrismaClient,
  archiveBuffer: Buffer,
  ownerId: number,
  userId: number | null,
  targetDir = uploadsDir,
  planOwnerKey = userId ? `user:${userId}` : 'desktop-local',
): Promise<ExternalImportResult> {
  const zip = new AdmZip(archiveBuffer);
  const records = extractRecordsFromZip(zip);
  if (!records.length) {
    return { importedFolders: 0, importedDocuments: 0, skipped: [] };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const plan = await getPlan(prisma, planOwnerKey);
  const writtenFiles: string[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];

  try {
    const result = await prisma.$transaction(async tx => {
      const existingFolders = await tx.folder.findMany({ where: { ownerId }, select: { id: true, name: true, parentId: true } });
      const folderByName = new Map<string, number>();
      for (const f of existingFolders) {
        if (f.parentId === null) folderByName.set(f.name.trim().toLowerCase(), f.id);
      }

      let importedFolders = 0;
      let importedDocuments = 0;

      for (const record of records) {
        const safeRel = sanitizeZipPath(record.file);
        const entry = zip.getEntry(safeRel) || zip.getEntries().find(e => !e.isDirectory && e.entryName.replace(/\\/g, '/') === safeRel);
        if (!entry) {
          skipped.push({ file: record.file, reason: 'Brak pliku w archiwum ZIP.' });
          continue;
        }
        const ext = path.extname(safeRel).toLowerCase();
        const mimeType = record.mimeType || MIME_BY_EXT[ext];
        if (!mimeType || !Object.values(MIME_BY_EXT).includes(mimeType)) {
          skipped.push({ file: record.file, reason: 'Nieobsługiwany typ pliku.' });
          continue;
        }

        const folderKey = record.folder.trim().toLowerCase();
        let folderId = folderByName.get(folderKey);
        if (!folderId) {
          const createdFolder = await tx.folder.create({
            data: { name: record.folder.slice(0, 120), ownerId, parentId: null, order: 0 },
            select: { id: true },
          });
          folderId = createdFolder.id;
          folderByName.set(folderKey, folderId);
          importedFolders++;
        }

        const fileBytes = entry.getData();
        const digest = crypto.createHash('sha256').update(fileBytes).digest('hex');
        try {
          await assertUniqueDocument(tx, ownerId, folderId, digest);
        } catch (err) {
          if (err instanceof DuplicateDocumentError) {
            skipped.push({ file: record.file, reason: 'Duplikat dokumentu w tej kartotece.' });
            continue;
          }
          throw err;
        }

        await checkDocumentCapacity(tx, ownerId, plan, 1);
        const storedName = `${crypto.randomUUID()}${ext || '.bin'}`;
        const destPath = path.join(targetDir, storedName);
        fs.writeFileSync(destPath, fileBytes);
        writtenFiles.push(destPath);

        await tx.document.create({
          data: {
            title: record.title.slice(0, 180),
            filePath: storedName,
            mimeType,
            folderId,
            userId,
            retentionEnabled: true,
            retentionValue: record.retentionValue ?? 5,
            retentionUnit: record.retentionUnit ?? 'years',
          },
        });
        importedDocuments++;
      }

      return { importedFolders, importedDocuments };
    });

    return { ...result, skipped };
  } catch (error) {
    for (const file of writtenFiles) {
      fs.rmSync(file, { force: true });
    }
    throw error;
  }
}
