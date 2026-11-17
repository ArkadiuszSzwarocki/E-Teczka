import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';
import { assertUniqueDocument } from './duplicateDocuments';
import { checkDocumentCapacity } from './planLedger';
import type { Plan } from './planPolicy';

export type ResumableMeta = {
  uploadId: string;
  ownerId: number;
  folderId: number;
  fileName: string;
  mimeType: string;
  totalChunks: number;
  createdAt: number;
};

const safeId = (raw: string) => /^[A-Za-z0-9_-]{8,64}$/.test(raw);
const sessionDir = (baseDir: string, uploadId: string) => path.join(baseDir, '.resumable', uploadId);
const metaPath = (baseDir: string, uploadId: string) => path.join(sessionDir(baseDir, uploadId), 'meta.json');
const chunkPath = (baseDir: string, uploadId: string, index: number) => path.join(sessionDir(baseDir, uploadId), `${index}.part`);

export function initResumableSession(
  input: { uploadId?: string; ownerId: number; folderId: number; fileName: string; mimeType: string; totalChunks: number },
  baseDir = uploadsDir,
): { uploadId: string; receivedChunks: number[] } {
  const uploadId = input.uploadId && safeId(input.uploadId) ? input.uploadId : crypto.randomUUID();
  const dir = sessionDir(baseDir, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  const mPath = metaPath(baseDir, uploadId);

  if (fs.existsSync(mPath)) {
    const existing = JSON.parse(fs.readFileSync(mPath, 'utf8')) as ResumableMeta;
    if (existing.ownerId !== input.ownerId || existing.folderId !== input.folderId || existing.totalChunks !== input.totalChunks) {
      throw new Error('Sesja uploadu nie pasuje do wybranego pliku lub kartoteki.');
    }
  } else {
    const meta: ResumableMeta = {
      uploadId,
      ownerId: input.ownerId,
      folderId: input.folderId,
      fileName: path.basename(input.fileName).slice(0, 180) || 'dokument.bin',
      mimeType: input.mimeType || 'application/octet-stream',
      totalChunks: input.totalChunks,
      createdAt: Date.now(),
    };
    fs.writeFileSync(mPath, JSON.stringify(meta));
  }

  const receivedChunks: number[] = [];
  for (let i = 0; i < input.totalChunks; i++) {
    if (fs.existsSync(chunkPath(baseDir, uploadId, i))) receivedChunks.push(i);
  }
  return { uploadId, receivedChunks };
}

export function writeResumableChunk(
  uploadId: string,
  ownerId: number,
  index: number,
  base64Data: string,
  baseDir = uploadsDir,
): void {
  if (!safeId(uploadId) || !Number.isInteger(index) || index < 0) {
    throw new Error('Nieprawidłowy identyfikator części pliku.');
  }
  const mPath = metaPath(baseDir, uploadId);
  if (!fs.existsSync(mPath)) throw new Error('Sesja uploadu nie istnieje.');
  const meta = JSON.parse(fs.readFileSync(mPath, 'utf8')) as ResumableMeta;
  if (meta.ownerId !== ownerId || index >= meta.totalChunks) {
    throw new Error('Brak uprawnień lub nieprawidłowy numer części.');
  }
  const dest = chunkPath(baseDir, uploadId, index);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(base64Data, 'base64'));
  fs.renameSync(tmp, dest);
}

export async function completeResumableSession(
  prisma: PrismaClient,
  uploadId: string,
  ownerId: number,
  userId: number | null,
  plan: Plan,
  baseDir = uploadsDir,
) {
  if (!safeId(uploadId)) throw new Error('Nieprawidłowy identyfikator sesji.');
  const mPath = metaPath(baseDir, uploadId);
  if (!fs.existsSync(mPath)) throw new Error('Sesja uploadu wygasła lub nie istnieje.');
  const meta = JSON.parse(fs.readFileSync(mPath, 'utf8')) as ResumableMeta;
  if (meta.ownerId !== ownerId) throw new Error('Brak uprawnień do sesji uploadu.');

  const buffers: Buffer[] = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    const p = chunkPath(baseDir, uploadId, i);
    if (!fs.existsSync(p)) throw new Error(`Brakuje części pliku nr ${i}.`);
    buffers.push(fs.readFileSync(p));
  }
  const fullBuffer = Buffer.concat(buffers);
  const digest = crypto.createHash('sha256').update(fullBuffer).digest('hex');
  const ext = path.extname(meta.fileName).toLowerCase() || '.bin';
  const storedName = `${crypto.randomUUID()}${ext}`;
  const finalPath = path.join(baseDir, storedName);

  try {
    fs.writeFileSync(finalPath, fullBuffer);
    const document = await prisma.$transaction(async tx => {
      await assertUniqueDocument(tx, ownerId, meta.folderId, digest);
      await checkDocumentCapacity(tx, ownerId, plan, 1);
      return tx.document.create({
        data: {
          title: meta.fileName,
          filePath: storedName,
          mimeType: meta.mimeType,
          folderId: meta.folderId,
          userId,
          retentionEnabled: true,
          retentionValue: 5,
          retentionUnit: 'years',
        },
      });
    });
    fs.rmSync(sessionDir(baseDir, uploadId), { recursive: true, force: true });
    return document;
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    throw error;
  }
}
