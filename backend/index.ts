import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { uploadsDir, securityDir } from './config/paths';
import path from 'node:path';
import https from 'node:https';
import { makeLocalTls } from './services/localTls';
import { requireSecureRemote } from './middleware/requireSecureRemote';
import { applyRetentionPolicy } from './services/retention';
import { configureAccountSessionValidator, registerPairingRoutes, requireAccess, requireLocalDesktop } from './middleware/accessControl';
import { createHash } from 'node:crypto';
import { createTagRouter } from './routes/tags';
import { createFolderRouter } from './routes/folders';
import { createPrinterScanRouter } from './routes/printerScan';
import { createScannerInboxRouter } from './routes/scannerInbox';
import { createDocumentRouter } from './routes/documents';
import { createSyncRouter } from './routes/sync';
import { createMobileScanRouter } from './routes/mobileScan';
import { errorMessage } from './utils/errors';
import { createBillingRouter, createBillingWebhookHandler } from './routes/billing';
import { createAuthRouter } from './routes/auth';
import { createBackupRouter, createBackupOAuthCallbackRouter } from './routes/backup';
import cron from 'node-cron';
import { runScheduledCloudBackup } from './routes/backup';
import { createBackupScheduler } from './services/backupScheduler';
import { createOcrQueue } from './services/ocrQueue';
import { createOcrRouter } from './routes/ocr';
import { createDevPlanRouter } from './routes/devPlans';
import { createSecureShareRouter } from './routes/secureShare';
import { createCentralAccountRouter } from './routes/centralAccount';

const prisma = new PrismaClient();
configureAccountSessionValidator(async (token, userId) => Boolean(await prisma.authSession.findFirst({ where: { tokenHash: createHash('sha256').update(token).digest('hex'), userId, expiresAt: { gt: new Date() } }, select: { id: true } })));
const app = express();
const ocrQueue = createOcrQueue(prisma, { file: path.join(securityDir, 'ocr-queue.enc'), uploadsDirectory: uploadsDir });

const localTls = makeLocalTls(securityDir);
app.use(cors());
// Local desktop can keep using loopback HTTP. Remote clients must use TLS;
// never redirect bearer tokens or pairing codes after receiving them over HTTP.
// The public certificate contains no credentials. Its fingerprint is verified
// against the QR code before it is saved or trusted on the phone.
app.get('/api/pairing-certificate', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain').send(localTls.caPem);
});
app.use(requireSecureRemote);
app.get('/api/local-ca', (req, res) => {
  const peer = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return res.sendStatus(403);
  res.setHeader('Content-Disposition', 'attachment; filename=E-Teczka-local-CA.crt');
  res.type('application/x-x509-ca-cert').send(localTls.caPem);
});
app.get('/api/local-ca-info', (req, res) => {
  const peer = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return res.sendStatus(403);
  res.json({ fingerprint: localTls.fingerprint });
});
// Stripe verifies the signature against the original bytes of the request.
// Register this route before the JSON parser consumes the request body.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), createBillingWebhookHandler(prisma));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

registerPairingRoutes(app);
app.use('/api/auth', createAuthRouter(prisma));
// The bridge accepts central credentials only from this computer. Linking is
// explicit and requires a live local session as well as a central session.
app.use('/api/central-account', requireLocalDesktop, createCentralAccountRouter(prisma));

app.use('/api/backup/oauth', createBackupOAuthCallbackRouter(prisma));

app.use('/api', requireAccess);
app.use('/uploads', requireAccess, express.static(uploadsDir));
app.use(requireAccess, express.static(uploadsDir));

void applyRetentionPolicy(prisma).catch((error: unknown) => console.error('[retention] Błąd polityki terminu życia:', errorMessage(error)));
setInterval(() => {
  void applyRetentionPolicy(prisma).catch((error: unknown) => console.error('[retention] Błąd polityki terminu życia:', errorMessage(error)));
}, 60_000);

// Check at startup and every minute so a missed scheduled backup can run later.
const checkScheduledBackups = createBackupScheduler(prisma, runScheduledCloudBackup);
const checkBackupsSafely = () => { void checkScheduledBackups().catch(error => console.error('[backup] Scheduler:', errorMessage(error))); };
checkBackupsSafely();
cron.schedule('* * * * *', checkBackupsSafely);

app.use('/api/folders', createFolderRouter(prisma));

app.use('/api/printer-scan', createPrinterScanRouter(prisma));
app.use('/api/ocr', createOcrRouter(prisma, ocrQueue));

app.use('/api/tags', createTagRouter(prisma));
app.use('/api/billing', createBillingRouter(prisma));
app.use('/api/dev/plan', createDevPlanRouter());
app.use('/api/backup', createBackupRouter(prisma));
app.use('/api/documents', createDocumentRouter(prisma, ocrQueue));
app.use('/api/secure-shares', createSecureShareRouter(prisma));
app.use('/api/sync', createSyncRouter(prisma));
app.use('/api', createMobileScanRouter(prisma, ocrQueue));

app.use('/api/scanner', createScannerInboxRouter(prisma, ocrQueue));

// ==========================================
// GLOBALNA PUŁAPKA NA NIEPRZEWIDZIANE BŁĘDY (CRASH CATCHER)
// ==========================================
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const details = errorMessage(err);
  console.error("!!! KRYTYCZNY BŁĄD SERWERA !!! Ścieżka:", req.url);
  console.error("Szczegóły:", details);
  res.status(500).json({ error: "Krytyczny błąd serwera", details });
});

app.listen(3000, '0.0.0.0', () => { console.log('Serwer lokalny HTTP: port 3000 (tylko komputer).'); void ocrQueue.process().catch(() => console.error('[ocr] Nie udało się wznowić kolejki.')); });
https.createServer({ key: localTls.key, cert: localTls.cert, minVersion: 'TLSv1.2' }, app).listen(3443, '0.0.0.0', () => console.log('Bezpieczne połączenia HTTPS: port 3443.'));
