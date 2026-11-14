import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';

type Db = PrismaClient | Prisma.TransactionClient;
export class DuplicateDocumentError extends Error {
  readonly code = 'DUPLICATE_DOCUMENT';
  constructor(public readonly existingTitle: string) { super(`Ten plik znajduje się już w tej kartotece: „${existingTitle}”.`); }
}
export const hashBuffer = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
export async function hashFile(filename: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
/** Compare stored bytes, scoped to an owned folder, including archive and trash. */
export async function assertUniqueDocument(db: Db, ownerId: number, folderId: number, digest: string, excludeId?: number) {
  const records = await db.document.findMany({ where: { folderId, folder: { ownerId }, ...(excludeId === undefined ? {} : { id: { not: excludeId } }) }, select: { filePath: true, title: true } });
  for (const record of records) {
    if (!record.filePath || path.basename(record.filePath) !== record.filePath) throw new Error('Nie można sprawdzić istniejącego pliku w kartotece.');
    let existing: string;
    try { existing = await hashFile(path.join(uploadsDir, record.filePath)); }
    catch { throw new Error('Nie można sprawdzić istniejącego pliku w kartotece.'); }
    if (existing === digest) throw new DuplicateDocumentError(record.title);
  }
}
