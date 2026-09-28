import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { scanDraftsDir } from '../config/paths';
import { isDocumentFolder } from '../services/folders';
import { getWiaDevices, runWiaPowerShell } from '../services/wia';
import { errorMessage, errorStatusCode } from '../utils/errors';

type PrinterScanJob = { status: 'running' | 'completed' | 'failed'; stage: string; error?: string; temporaryPath?: string; createdAt: number };

export function createPrinterScanRouter(prisma: PrismaClient) {
  const router = express.Router();
  const jobs = new Map<string, PrinterScanJob>();
  let activeJobId: string | null = null;

  router.get('/devices', async (_req, res) => {
    try { res.json(await getWiaDevices()); }
    catch (error: unknown) { res.status(503).json({ error: errorMessage(error, 'Nie udało się wykryć skanerów WIA.') }); }
  });

  router.post('/', async (req, res) => {
    const folderId = Number(req.body?.folderId);
    const requestedDeviceId = String(req.body?.deviceId || '');
    if (!await isDocumentFolder(prisma, folderId)) return res.status(400).json({ error: 'Wybierz podkartotekę docelową.' });
    if (activeJobId) return res.status(409).json({ error: 'Na komputerze trwa już inne skanowanie.' });
    let deviceNumber: number;
    try { deviceNumber = (await getWiaDevices()).findIndex(device => device.id === requestedDeviceId) + 1; }
    catch (error: unknown) { return res.status(503).json({ error: errorMessage(error, 'Nie udało się odczytać skanerów.') }); }
    if (!deviceNumber) return res.status(400).json({ error: 'Wybrany skaner nie jest już dostępny.' });
    const jobId = crypto.randomUUID();
    const job: PrinterScanJob = { status: 'running', stage: 'Zlecenie odebrane przez komputer…', createdAt: Date.now() };
    jobs.set(jobId, job); activeJobId = jobId; res.status(202).json({ jobId });
    void runPrinterScan(job, deviceNumber).finally(() => { activeJobId = null; });
  });

  router.get('/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Zlecenie skanowania wygasło.' });
    res.json({ status: job.status, stage: job.stage, error: job.error, createdAt: job.createdAt });
  });

  router.get('/:jobId/file', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || job.status !== 'completed' || !job.temporaryPath || !fs.existsSync(job.temporaryPath)) return res.status(404).json({ error: 'Plik wersji roboczej nie jest dostępny.' });
    const temporaryPath = job.temporaryPath;
    res.type('jpeg').sendFile(temporaryPath, { dotfiles: 'allow' }, error => {
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
