import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from './backupCrypto';
import { protectOcrText } from './ocrText';
import { extractDocumentText } from './ocrEngine';
import { featureTrial } from './planLedger';

type State = 'queued' | 'processing' | 'done' | 'error' | 'paused';
type Job = { documentId: number; ownerKey: string; state: State; error?: string; updatedAt: number };
type Options = { file: string; uploadsDirectory: string; extract?: typeof extractDocumentText };

/** Durable, serialized local queue. The state and recognized text are encrypted on disk. */
export function createOcrQueue(prisma: PrismaClient, options: Options) {
  let running = false;
  const extract = options.extract || extractDocumentText;
  function read(): Job[] {
    let value: string;
    try { value = fs.readFileSync(options.file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result = JSON.parse(decrypt(value)) as unknown;
    if (!Array.isArray(result)) throw new Error('Nie można odczytać kolejki OCR.');
    return result as Job[];
  }
  function write(jobs: Job[]) {
    fs.mkdirSync(path.dirname(options.file), { recursive: true });
    const temporary = `${options.file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try { fs.writeFileSync(temporary, encrypt(JSON.stringify(jobs)), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, options.file); }
    finally { try { fs.unlinkSync(temporary); } catch { /* renamed */ } }
  }
  function update(id: number, ownerKey: string, patch: Partial<Job>) {
    const jobs = read(); const index = jobs.findIndex(job => job.documentId === id && job.ownerKey === ownerKey);
    if (index < 0) return;
    jobs[index] = { ...jobs[index], ...patch, updatedAt: Date.now() }; write(jobs);
  }
  function enqueue(documentId: number, ownerKey: string) {
    const jobs = read(); const index = jobs.findIndex(job => job.documentId === documentId && job.ownerKey === ownerKey);
    if (index >= 0 && (jobs[index].state === 'queued' || jobs[index].state === 'processing')) return;
    const job: Job = { documentId, ownerKey, state: 'queued', updatedAt: Date.now() };
    if (index >= 0) jobs[index] = job; else jobs.push(job);
    write(jobs); void process().catch(error => console.error('[ocr] Kolejka:', error instanceof Error ? error.message : 'błąd'));
  }
  function status(documentId: number, ownerKey: string) {
    const job = read().find(item => item.documentId === documentId && item.ownerKey === ownerKey);
    return job ? { state: job.state, error: job.error || null, updatedAt: job.updatedAt } : { state: 'not_started', error: null };
  }
  async function process() {
    if (running) return;
    running = true;
    try {
      // Interrupted work can be retried after the process restarts.
      const jobs = read(); let changed = false;
      for (const job of jobs) if (job.state === 'processing') { job.state = 'queued'; changed = true; }
      if (changed) write(jobs);
      for (;;) {
        const next = read().find(job => job.state === 'queued'); if (!next) break;
        if (!(await featureTrial(prisma, next.ownerKey, 'ocr', false)).allowed) { update(next.documentId, next.ownerKey, { state: 'paused', error: 'Okres próbny OCR zakończył się. Funkcja wymaga planu Premium.' }); continue; }
        update(next.documentId, next.ownerKey, { state: 'processing', error: undefined });
        try {
          const document = await prisma.document.findUnique({ where: { id: next.documentId }, select: { id: true, filePath: true, mimeType: true, isDeleted: true } });
          if (!document || document.isDeleted) throw new Error('Dokument nie jest dostępny.');
          const fullPath = path.resolve(options.uploadsDirectory, document.filePath);
          const relative = path.relative(path.resolve(options.uploadsDirectory), fullPath);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Nieprawidłowa ścieżka dokumentu.');
          const text = await extract(fullPath, document.mimeType);
          if (text.length > 2_000_000) throw new Error('Dokument przekracza limit 2 milionów znaków tekstu OCR.');
          const updated = await prisma.document.updateMany({ where: { id: document.id, filePath: document.filePath, isDeleted: false }, data: { ocrText: protectOcrText(text) } });
          if (updated.count !== 1) throw new Error('Dokument zmienił się podczas rozpoznawania.');
          update(next.documentId, next.ownerKey, { state: 'done' });
        } catch (error) {
          const message = error instanceof Error && /Brak lokalnego pliku językowego|przekracza limit|format dokumentu|nie jest dostępny|Dokument zmienił/.test(error.message) ? error.message : 'Nie udało się rozpoznać dokumentu. Sprawdź plik i spróbuj ponownie.';
          update(next.documentId, next.ownerKey, { state: 'error', error: message });
        }
      }
    } finally { running = false; }
  }
  return { enqueue, status, process };
}
