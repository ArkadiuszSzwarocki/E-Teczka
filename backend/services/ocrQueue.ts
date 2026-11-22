import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { encrypt, decrypt } from './backupCrypto';
import { protectOcrText } from './ocrText';
import { extractDocumentText } from './ocrEngine';
import { extractFinanceFromOcr } from './financeOcrParser';
import { parseReceiptFromOcr } from './receiptOcrParser';
import { featureTrial } from './planLedger';

type State = 'queued' | 'processing' | 'done' | 'error' | 'paused';
type Job = { documentId: number; ownerKey: string; state: State; error?: string; attempts?: number; updatedAt: number };
type Options = { file: string; uploadsDirectory: string; extract?: typeof extractDocumentText };

/** Durable, serialized local queue. The state and recognized text are encrypted on disk. */
export function createOcrQueue(prisma: PrismaClient, options: Options) {
  let running = false;
  const extract = options.extract || extractDocumentText;
  function read(): Job[] {
    let value: string;
    try { value = fs.readFileSync(options.file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    try {
      const result = JSON.parse(decrypt(value)) as unknown;
      return Array.isArray(result) ? (result as Job[]) : [];
    } catch {
      console.error('[ocr] Uszkodzony plik kolejki OCR — zresetowano stan kolejki.');
      return [];
    }
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
      // Interrupted work (up to 3 crash retries) and previously paused jobs (e.g. after upgrading to Premium) can resume.
      const jobs = read(); let changed = false;
      for (const job of jobs) {
        if (job.state === 'processing') {
          const nextAttempts = (job.attempts || 0) + 1;
          job.attempts = nextAttempts;
          if (nextAttempts > 3) {
            job.state = 'error';
            job.error = 'Plik wielokrotnie przerwał rozpoznawanie OCR (uszkodzony lub zbyt duży dokument).';
          } else {
            job.state = 'queued';
          }
          changed = true;
        } else if (job.state === 'paused' && (await featureTrial(prisma, job.ownerKey, 'ocr', false)).allowed) {
          job.state = 'queued'; job.error = undefined; changed = true;
        }
      }
      if (changed) write(jobs);
      const ocrAccessCache = new Map<string, boolean>();
      for (;;) {
        const next = read().find(job => job.state === 'queued'); if (!next) break;
        let allowed = ocrAccessCache.get(next.ownerKey);
        if (allowed === undefined) {
          allowed = Boolean((await featureTrial(prisma, next.ownerKey, 'ocr', false)).allowed);
          ocrAccessCache.set(next.ownerKey, allowed);
        }
        if (!allowed) { update(next.documentId, next.ownerKey, { state: 'paused', error: 'Okres próbny OCR zakończył się. Funkcja wymaga planu Premium.' }); continue; }
        update(next.documentId, next.ownerKey, { state: 'processing', error: undefined });
        try {
          const document = await prisma.document.findUnique({ where: { id: next.documentId }, select: { id: true, title: true, filePath: true, mimeType: true, isDeleted: true, merchantName: true, amountCents: true, dueDate: true, paymentStatus: true } });
          if (!document || document.isDeleted) throw new Error('Dokument nie jest dostępny.');
          const fullPath = path.resolve(options.uploadsDirectory, document.filePath);
          const relative = path.relative(path.resolve(options.uploadsDirectory), fullPath);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Nieprawidłowa ścieżka dokumentu.');
          const text = await extract(fullPath, document.mimeType);
          if (text.length > 2_000_000) throw new Error('Dokument przekracza limit 2 milionów znaków tekstu OCR.');
          const extracted = extractFinanceFromOcr(text, document.title);
          const receipt = parseReceiptFromOcr(text);
          const financePatch: { merchantName?: string; amountCents?: number; currency?: string; dueDate?: Date; paymentStatus?: string } = {};
          if (!document.merchantName && receipt.merchantName) financePatch.merchantName = receipt.merchantName;
          const detectedCents = receipt.amountCents ?? extracted.amountCents;
          if (document.amountCents === null && detectedCents !== null) {
            financePatch.amountCents = detectedCents;
            financePatch.currency = receipt.amountCents !== null ? 'PLN' : (extracted.currency || 'PLN');
            if (!document.paymentStatus) financePatch.paymentStatus = receipt.paymentStatus || 'unpaid';
          } else if (!document.paymentStatus && receipt.paymentStatus) {
            financePatch.paymentStatus = receipt.paymentStatus;
          }
          if (document.dueDate === null && extracted.dueDate !== null) {
            financePatch.dueDate = extracted.dueDate;
          }
          await prisma.$transaction(async tx => {
            const updated = await tx.document.updateMany({ where: { id: document.id, filePath: document.filePath, isDeleted: false }, data: { ocrText: protectOcrText(text), ...financePatch } });
            if (updated.count !== 1) throw new Error('Dokument zmienił się podczas rozpoznawania.');
            if (receipt.items.length > 0) {
              await tx.documentLineItem.deleteMany({ where: { documentId: document.id } });
              await tx.documentLineItem.createMany({
                data: receipt.items.map(item => ({
                  documentId: document.id,
                  name: item.name,
                  quantity: item.quantity,
                  totalCents: item.totalCents,
                  category: item.category,
                })),
              });
            }
          });
          update(next.documentId, next.ownerKey, { state: 'done' });
        } catch (error) {
          const rawMsg = error instanceof Error ? error.message : '';
          const message = /password|encrypted|has[łl]/i.test(rawMsg)
            ? 'Plik PDF jest zabezpieczony hasłem — nie można uruchomić OCR.'
            : /Brak lokalnego pliku językowego|przekracza limit|format dokumentu|nie jest dostępny|Dokument zmienił/.test(rawMsg)
              ? rawMsg
              : 'Nie udało się rozpoznać dokumentu. Sprawdź plik i spróbuj ponownie.';
          update(next.documentId, next.ownerKey, { state: 'error', error: message });
        }
      }
    } finally { running = false; }
  }
  return { enqueue, status, process };
}
