import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { scanDraftsDir } from '../config/paths';
import { getWiaDevices, runWiaPowerShell } from '../services/wia';
import { errorMessage, errorStatusCode } from '../utils/errors';
import { resolveSafePath } from '../utils/safePath';
import { ocrOwnerKey } from '../services/ocrPremium';
import { accountingKey } from '../services/devPlans';
import { getPlan, ensurePlanLedger, consumeUsage, PlanLimitError } from '../services/planLedger';

type PrinterScanJob = { ownerId: number; status: 'running' | 'completed' | 'failed'; stage: string; error?: string; temporaryPath?: string; createdAt: number };
const JOB_TTL_MS = 15 * 60_000;

export function createPrinterScanRouter(prisma: PrismaClient) {
  const router = express.Router();
  const jobs = new Map<string, PrinterScanJob>();
  let activeJobId: string | null = null;

  const pruneStaleJobs = () => {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs.entries()) {
      if (job.status === 'running' || job.createdAt > cutoff) continue;
      if (job.temporaryPath) {
        try { if (fs.existsSync(job.temporaryPath)) fs.unlinkSync(job.temporaryPath); } catch { /* ignore cleanup errors */ }
      }
      jobs.delete(id);
    }
  };
  setInterval(pruneStaleJobs, 5 * 60_000).unref();

  router.get('/devices', async (_req, res) => {
    try { res.json(await getWiaDevices()); }
    catch (error: unknown) { res.status(503).json({ error: errorMessage(error, 'Nie udało się wykryć skanerów WIA.') }); }
  });

  router.post('/', async (req, res) => {
    const rawFolderId = req.body?.folderId;
    if (rawFolderId !== undefined && rawFolderId !== null && rawFolderId !== '') {
      const folderId = Number(rawFolderId);
      if (!await prisma.folder.findFirst({ where: { id: folderId, ownerId: Number(res.locals.userId || 1), parentId: { not: null } }, select: { id: true } })) return res.status(400).json({ error: 'Wybierz własną podkartotekę docelową.' });
    }
    const requestedDeviceId = String(req.body?.deviceId || '');
    if (activeJobId) return res.status(409).json({ error: 'Na komputerze trwa już inne skanowanie.' });
    let deviceNumber: number;
    try { deviceNumber = (await getWiaDevices()).findIndex(device => device.id === requestedDeviceId) + 1; }
    catch (error: unknown) { return res.status(503).json({ error: errorMessage(error, 'Nie udało się odczytać skanerów.') }); }
    if (!deviceNumber) return res.status(400).json({ error: 'Wybrany skaner nie jest już dostępny.' });
    const jobId = crypto.randomUUID(); const key = ocrOwnerKey(res);
    try { const plan = await getPlan(prisma, key); await ensurePlanLedger(prisma); await prisma.$transaction(tx => consumeUsage(tx, key, plan, 'printerScan', jobId, 1)); } catch (error) { if (error instanceof PlanLimitError) return res.status(403).json({ code: error.code, error: error.message, resetsAt: error.resetsAt }); return res.status(500).json({ error: 'Nie udało się sprawdzić limitu skanowania.' }); }
    pruneStaleJobs();
    const job: PrinterScanJob = { ownerId: Number(res.locals.userId || 1), status: 'running', stage: 'Zlecenie odebrane przez komputer…', createdAt: Date.now() };
    jobs.set(jobId, job); activeJobId = jobId; res.status(202).json({ jobId });
    void runPrinterScan(job, deviceNumber).finally(async () => { if (job.status === 'failed') { try { await prisma.$executeRaw`DELETE FROM PlanUsage WHERE ownerKey = ${accountingKey(key)} AND feature = ${'printerScan'} AND operationId = ${jobId}`; } catch { console.error('[scan] Nie udało się cofnąć licznika nieudanego skanu.'); } } activeJobId = null; });
  });

  router.get('/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.ownerId !== Number(res.locals.userId || 1)) return res.status(404).json({ error: 'Zlecenie skanowania wygasło.' });
    res.json({ status: job.status, stage: job.stage, error: job.error, createdAt: job.createdAt });
  });

  router.get('/:jobId/file', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.ownerId !== Number(res.locals.userId || 1) || job.status !== 'completed' || !job.temporaryPath || !fs.existsSync(job.temporaryPath)) return res.status(404).json({ error: 'Plik wersji roboczej nie jest dostępny.' });
    const safeFileName = path.basename(job.temporaryPath);
    const temporaryPath = resolveSafePath(scanDraftsDir, safeFileName);
    res.type('jpeg').sendFile(safeFileName, { root: path.resolve(scanDraftsDir) }, error => {
      if (error) { console.error('Nie udało się przekazać skanu do telefonu:', error); if (!res.headersSent) res.status(errorStatusCode(error) ?? 500).json({ error: 'Nie udało się przekazać skanu do telefonu.' }); return; }
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      jobs.delete(req.params.jobId);
    });
  });

  return router;
}

async function runPrinterScan(job: PrinterScanJob, deviceNumber: number) {
  try {
    const temporaryPath = path.join(scanDraftsDir, `scan_printer_${Date.now()}_${crypto.randomUUID()}.jpg`);
    const outputPath = temporaryPath.replace(/'/g, "''");
    const rawPath = path.join(scanDraftsDir, `raw_${crypto.randomUUID()}.jpg`).replace(/'/g, "''");
    job.stage = 'Łączenie ze skanerem…';
    const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Drawing; $manager = New-Object -ComObject WIA.DeviceManager; $info = $manager.DeviceInfos.Item(${deviceNumber}); if ($info.Type -ne 1) { throw 'Wybrane urządzenie nie jest skanerem.' }; $device = $info.Connect(); $item = $device.Items.Item(1); $image = $item.Transfer('{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'); $image.SaveFile('${rawPath}'); $source = [System.Drawing.Image]::FromFile('${rawPath}'); try { $maxEdge = 2200; $scale = [Math]::Min(1.0, $maxEdge / [Math]::Max($source.Width, $source.Height)); $width = [Math]::Max(1, [int]($source.Width * $scale)); $height = [Math]::Max(1, [int]($source.Height * $scale)); $bitmap = New-Object System.Drawing.Bitmap($width, $height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality; $graphics.DrawImage($source, 0, 0, $width, $height); $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }; $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1); $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]68); $bitmap.Save('${outputPath}', $codec, $encoderParams); $encoderParams.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); } finally { $source.Dispose(); Remove-Item -LiteralPath '${rawPath}' -Force -ErrorAction SilentlyContinue }; Write-Output '${outputPath}'`;
    setTimeout(() => { if (job.status === 'running') job.stage = 'Skanowanie strony…'; }, 700);
    await runWiaPowerShell(script);
    if (!fs.existsSync(temporaryPath)) throw new Error('Skaner nie zwrócił obrazu.');
    job.status = 'completed'; job.stage = 'Skan gotowy do edycji.'; job.temporaryPath = temporaryPath;
  } catch (error: unknown) { job.status = 'failed'; job.stage = 'Skanowanie nie powiodło się.'; job.error = errorMessage(error, 'Nie udało się zeskanować dokumentu.'); }
}
