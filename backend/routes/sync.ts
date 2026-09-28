import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { isDocumentFolder } from '../services/folders';
import { errorMessage } from '../utils/errors';

type RetentionUnit = 'years' | 'months' | 'days' | 'minutes';
type SyncDocument = { title: string; filePath: string; mimeType: string; folderId: number; retentionValue?: number; retentionUnit?: RetentionUnit; thumbnail?: string | null };
const retentionUnits = new Set<RetentionUnit>(['years', 'months', 'days', 'minutes']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseCreatedDocuments(changes: unknown): SyncDocument[] | null {
  const documents = asRecord(asRecord(changes)?.documents);
  if (!documents || documents.created === undefined) return [];
  if (!Array.isArray(documents.created)) return null;
  const parsed: SyncDocument[] = [];
  for (const value of documents.created) {
    const document = asRecord(value);
    if (!document || typeof document.title !== 'string' || typeof document.filePath !== 'string' || typeof document.mimeType !== 'string') return null;
    const folderId = Number(document.folderId);
    const retentionValue = document.retentionValue === undefined ? undefined : Number(document.retentionValue);
    const retentionUnit = document.retentionUnit;
    if (!Number.isInteger(folderId) || folderId < 1 || (retentionValue !== undefined && (!Number.isFinite(retentionValue) || retentionValue < 1)) || (retentionUnit !== undefined && (typeof retentionUnit !== 'string' || !retentionUnits.has(retentionUnit as RetentionUnit))) || (document.thumbnail !== undefined && document.thumbnail !== null && typeof document.thumbnail !== 'string')) return null;
    parsed.push({ title: document.title.trim(), filePath: document.filePath, mimeType: document.mimeType, folderId, retentionValue, retentionUnit: retentionUnit as RetentionUnit | undefined, thumbnail: document.thumbnail as string | null | undefined });
  }
  return parsed;
}

/** WatermelonDB synchronization endpoints. */
export function createSyncRouter(prisma: PrismaClient) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    const timestamp = req.query.lastPulledAt ? Number(req.query.lastPulledAt) : 0;
    if (!Number.isFinite(timestamp) || timestamp < 0) return res.status(400).json({ error: 'Nieprawidłowy znacznik synchronizacji.' });
    const lastPulledAt = new Date(timestamp);
    try {
      const createdFolders = await prisma.folder.findMany({ where: { createdAt: { gt: lastPulledAt } } });
      const updatedFolders = await prisma.folder.findMany({ where: { updatedAt: { gt: lastPulledAt }, createdAt: { lte: lastPulledAt } } });
      const createdDocs = await prisma.document.findMany({ where: { createdAt: { gt: lastPulledAt } } });
      const updatedDocs = await prisma.document.findMany({ where: { updatedAt: { gt: lastPulledAt }, createdAt: { lte: lastPulledAt } } });
      res.json({
        changes: {
          folders: { created: createdFolders, updated: updatedFolders, deleted: [] },
          documents: { created: createdDocs, updated: updatedDocs, deleted: [] },
        },
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error('[GET /api/sync] Błąd Pull:', details);
      res.status(500).json({ error: 'Błąd pobierania synchronizacji.', details });
    }
  });
  router.post('/', async (req, res) => {
    const documents = parseCreatedDocuments(req.body?.changes);
    if (!documents) return res.status(400).json({ error: 'Nieprawidłowe dane synchronizacji.' });
    try {
      for (const document of documents) {
        if (!document.title || !await isDocumentFolder(prisma, document.folderId)) {
          return res.status(400).json({ error: 'Dokumenty można synchronizować wyłącznie do istniejących podkartotek.' });
        }
      }
      await prisma.$transaction(documents.map((document) => prisma.document.create({ data: {
        title: document.title, filePath: document.filePath, mimeType: document.mimeType, folderId: document.folderId,
        retentionValue: document.retentionValue ?? 5, retentionUnit: document.retentionUnit ?? 'years', thumbnail: document.thumbnail ?? null,
      } })));
      res.json({ success: true, createdDocuments: documents.length });
    } catch (error: unknown) {
      const details = errorMessage(error);
      console.error('[POST /api/sync] Błąd Push:', details);
      res.status(500).json({ error: 'Błąd zapisu synchronizacji.', details });
    }
  });
  return router;
}
