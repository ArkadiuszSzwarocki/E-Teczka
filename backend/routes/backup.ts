import express from 'express';
import fs from 'fs';
import path from 'path';
import * as archiver from 'archiver';
import AdmZip from 'adm-zip';
import multer from 'multer';
import type { PrismaClient } from '@prisma/client';
import { uploadsDir } from '../config/paths';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res: express.Response) => Number(res.locals.userId || 1);

export function createBackupRouter(prisma: PrismaClient) {
  const router = express.Router();

  router.get('/export', async (req, res) => {
    const currentOwner = ownerId(res);
    const folders = await prisma.folder.findMany({ where: { ownerId: currentOwner }, orderBy: { id: 'asc' } });
    const documents = await prisma.document.findMany({ where: { folder: { ownerId: currentOwner } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
    const manifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      folders,
      documents: documents.map(({ tags, ...document }) => ({ ...document, tags: tags.map(({ tag }) => tag) })),
    };
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
    const archive = (archiver as any)('zip', { zlib: { level: 6 } });
    archive.on('error', (error: Error) => { if (!res.headersSent) res.status(500); res.end(); console.error('[backup] export:', error); });
    archive.pipe(res);
    archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
    for (const document of documents) {
      const source = path.join(uploadsDir, document.filePath);
      if (fs.existsSync(source)) archive.file(source, { name: `files/${document.id}-${path.basename(document.filePath)}` });
    }
    await archive.finalize();
  });

  router.post('/restore', upload.single('backup'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Wybierz plik kopii zapasowej.' });
    try {
      const zip = new AdmZip(req.file.buffer);
      const manifestEntry = zip.getEntry('manifest.json');
      if (!manifestEntry) return res.status(400).json({ error: 'Nieprawidłowa kopia: brak manifestu.' });
      const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as { version?: number; folders?: Array<Record<string, unknown>>; documents?: Array<Record<string, unknown> & { tags?: Array<Record<string, unknown>> }> };
      if (manifest.version !== 1 || !Array.isArray(manifest.folders) || !Array.isArray(manifest.documents)) return res.status(400).json({ error: 'Nieobsługiwana wersja kopii zapasowej.' });
      const currentOwner = ownerId(res);
      const folderMap = new Map<number, number>();
      await prisma.$transaction(async tx => {
        const pending = [...manifest.folders!];
        while (pending.length) {
          const index = pending.findIndex(folder => !folder.parentId || folderMap.has(Number(folder.parentId)));
          if (index < 0) throw new Error('Nieprawidłowa hierarchia kartotek.');
          const source = pending.splice(index, 1)[0];
          const created = await tx.folder.create({ data: { name: String(source.name || 'Przywrócona kartoteka').slice(0, 255), parentId: source.parentId ? folderMap.get(Number(source.parentId)) || null : null, ownerId: currentOwner, order: Number(source.order) || 0 } });
          folderMap.set(Number(source.id), created.id);
        }
        for (const source of manifest.documents!) {
          const folderId = folderMap.get(Number(source.folderId));
          if (!folderId) continue;
          const entryName = `files/${source.id}-${path.basename(String(source.filePath || ''))}`;
          const entry = zip.getEntry(entryName);
          if (!entry) continue;
          const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${path.basename(String(source.filePath))}`;
          fs.writeFileSync(path.join(uploadsDir, safeName), entry.getData());
          const created = await tx.document.create({ data: { title: String(source.title || 'Przywrócony dokument').slice(0, 255), filePath: safeName, mimeType: String(source.mimeType || 'application/octet-stream'), folderId, userId: res.locals.userId ? currentOwner : null, retentionEnabled: source.retentionEnabled !== false, retentionValue: Number(source.retentionValue) || 5, retentionUnit: String(source.retentionUnit || 'years'), isArchived: Boolean(source.isArchived), isDeleted: false, ocrText: typeof source.ocrText === 'string' ? source.ocrText.slice(0, 100_000) : null } });
          for (const tag of source.tags || []) {
            const tagRecord = await tx.tag.upsert({ where: { name: String(tag.name || '').slice(0, 80) }, create: { name: String(tag.name || 'tag').slice(0, 80), color: String(tag.color || '#2563eb') }, update: {} });
            await tx.documentTag.create({ data: { documentId: created.id, tagId: tagRecord.id } }).catch(() => undefined);
          }
        }
      });
      res.json({ success: true, restoredFolders: manifest.folders.length, restoredDocuments: manifest.documents.length });
    } catch (error) { console.error('[backup] restore:', error); res.status(400).json({ error: 'Nie udało się przywrócić kopii zapasowej.' }); }
  });
  return router;
}
