import { createAccountSecurityRouter } from './routes/accountSecurity';
import { ensureIdleSessionPolicy,activeSessionWhere } from './services/sessionPolicy';
import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { uploadsDir, securityDir } from './config/paths';
import path from 'node:path';
import https from 'node:https';
import { makeLocalTls } from './services/localTls';
import { attachRealtimeServer, closeRealtimeServer } from './services/realtimeBus';
import { requireSecureRemote } from './middleware/requireSecureRemote';
import { applyRetentionPolicy } from './services/retention';
import { configureAccountSessionValidator, registerPairingRoutes, requireAccess, requireLocalDesktop, resolvePairedDeviceOwner } from './middleware/accessControl';
import { createHash } from 'node:crypto';
import { createTagRouter } from './routes/tags';
import { createFolderRouter } from './routes/folders';
import { createPrinterScanRouter } from './routes/printerScan';
import { createScannerInboxRouter } from './routes/scannerInbox';
import { createMailInboxRouter } from './routes/mailInbox';
import { createAutomationRouter } from './routes/automation';
import { createKsefRouter } from './routes/ksef';
import { listScheduledKsefOwners } from './services/ksefCredentialsStore';
import { syncKsefInvoices } from './services/ksefSyncService';
import { createDocumentRouter } from './routes/documents';
import { createSyncRouter } from './routes/sync';
import { createMobileScanRouter } from './routes/mobileScan';
import { getAccessibleFolderIds } from './services/familyAccess';
import { errorMessage } from './utils/errors';
import { createBillingReturnRouter, createBillingRouter, createBillingWebhookHandler } from './routes/billing';
import { createAuthRouter } from './routes/auth';
import { createHelloAuthRouter } from './routes/helloAuth';
import { centralEntitlement } from './services/centralEntitlements';
import { instrumentPlanTransactions } from './services/centralPlanLedger';
import { createBackupRouter, createBackupOAuthCallbackRouter } from './routes/backup';
import { createFolderVaultRouter } from './routes/folderVault';
import cron from 'node-cron';
import { runScheduledCloudBackup } from './routes/backup';
import { createBackupScheduler } from './services/backupScheduler';
import { cleanupExpiredResumableSessions } from './services/resumableUpload';
import { createOcrQueue } from './services/ocrQueue';
import { createOcrRouter } from './routes/ocr';
import { getPlan } from './services/planLedger';
import { getCatalog } from './services/planCatalog';
import { createDeveloperCatalogRouter } from './routes/developerCatalog';
import { createDevPlanRouter } from './routes/devPlans';
import { createSecureShareRouter } from './routes/secureShare';
import { createCentralAccountRouter } from './routes/centralAccount';
import { createArchiveWorkspaceRouter } from './routes/archiveWorkspace';
import { createDeveloperFeedbackRouter, createFeedbackRouter } from './routes/feedback';
import { createAnalyticsRouter } from './routes/analytics';
import { createFamilyRouter } from './routes/family';
import { createTesterConsentRouter } from './routes/testerConsent';
import { createLegalRouter } from './routes/legal';
import { createAppVersionRouter } from './routes/appVersion';
import fs from 'node:fs';

const prisma = new PrismaClient();
void prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => undefined);
void prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;').catch(() => undefined);
instrumentPlanTransactions(prisma);
const idlePolicyReady=ensureIdleSessionPolicy(prisma);
configureAccountSessionValidator(async (token, userId) => Boolean(await prisma.authSession.findFirst({ where: { tokenHash: createHash('sha256').update(token).digest('hex'), userId, ...activeSessionWhere() }, select: { id: true } })));
const app = express();
app.disable('x-powered-by');
const ocrQueue = createOcrQueue(prisma, { file: path.join(securityDir, 'ocr-queue.enc'), uploadsDirectory: uploadsDir });

const localTls = makeLocalTls(securityDir);
const extraCorsOrigins = new Set(
  (process.env.MOJATECZKA_CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : 'https://e-teczkatest.arecki.pl'))
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);
const isAllowedCorsOrigin = (origin?: string) =>
  !origin ||
  origin === 'null' ||
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
  extraCorsOrigins.has(origin);
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedCorsOrigin(origin));
  },
}));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https: wss:;",
  );
  next();
});
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
  res.setHeader('Content-Disposition', 'attachment; filename=MojaTeczka-local-CA.crt');
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
app.use(['/api/documents/upload-base64', '/api/documents/upload-resumable', '/api/documents/id-card-copy'], express.json({ limit: '50mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api',async(_req,res,next)=>{try{await idlePolicyReady;next();}catch{res.status(503).json({error:'Nie udało się przygotować sesji.'});}});
registerPairingRoutes(app, async owner => getCatalog().plans[await getPlan(prisma, owner)].mobileDevices);
app.use('/api/auth', createAuthRouter(prisma));
app.use('/api/hello', createHelloAuthRouter(prisma));
// The bridge accepts central credentials only from this computer. Linking is
// explicit and requires a live local session as well as a central session.
app.use('/api/central-account', requireLocalDesktop, createCentralAccountRouter(prisma));

app.use('/api/backup/oauth', createBackupOAuthCallbackRouter(prisma));
app.use('/api/billing', createBillingReturnRouter(prisma));

app.use('/api/dev/catalog', createDeveloperCatalogRouter(prisma));
app.use('/api/dev/feedback', createDeveloperFeedbackRouter(prisma));
app.use('/api/legal', createLegalRouter());
app.use('/api/app-version', createAppVersionRouter());
const mobileTestApkPath = path.resolve(__dirname, '../MojaTeczkaMobile/android/app/build/outputs/apk/debug/app-debug.apk');
const mobileTestApkAllowed = () => (process.env.MOJATECZKA_PUBLIC_TEST_MODE === '1' || process.env.MOJATECZKA_DEV_PLANS === '1') && process.env.NODE_ENV !== 'production' && fs.existsSync(mobileTestApkPath);
app.get('/api/mobile-app/status', (_req, res) => {
  if (!mobileTestApkAllowed()) return res.json({ available: false });
  const sizeMb = Math.round((fs.statSync(mobileTestApkPath).size / (1024 * 1024)) * 10) / 10;
  return res.json({ available: true, path: '/api/mobile-app/download', sizeMb });
});
app.get('/api/mobile-app/download', (_req, res) => {
  if (!mobileTestApkAllowed()) return res.status(404).json({ error: 'Plik instalacyjny testowy nie jest dostępny.' });
  res.download(mobileTestApkPath, 'MojaTeczka-test.apk');
});
const centralDeviceGate:express.RequestHandler=async(_req,res,next)=>{if(res.locals.userId){const state=await centralEntitlement(Number(res.locals.userId));if(state?.blocked)return res.status(403).json({code:'DEVICE_REVOKED',error:'To urządzenie nie ma już uprawnień do konta. Zaloguj się ponownie lub sprawdź urządzenia na stronie konta.'});}next();};
const frontendDistDir = path.resolve(__dirname, '../frontend/dist');
const hasFrontendBundle = fs.existsSync(path.join(frontendDistDir, 'index.html'));
if (hasFrontendBundle) {
  app.use(express.static(frontendDistDir));
}

const verifyUploadAccess: express.RequestHandler = async (req, res, next) => {
  const userId = res.locals.userId ? Number(res.locals.userId) : null;
  if (!userId) return next();
  let rel = '';
  try {
    rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
  } catch {
    return res.sendStatus(400);
  }
  if (!rel || rel.includes('/') || rel.includes('\\') || rel.includes('..')) return res.sendStatus(404);
  try {
    const accessibleIds = await getAccessibleFolderIds(prisma, userId);
    const owned = await prisma.document.findFirst({
      where: {
        filePath: rel,
        OR: [{ userId }, { folderId: { in: accessibleIds } }],
      },
      select: { id: true },
    });
    if (!owned) return res.sendStatus(403);
    return next();
  } catch {
    return res.sendStatus(503);
  }
};

app.use('/api', requireAccess, centralDeviceGate);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/uploads', requireAccess, centralDeviceGate, verifyUploadAccess, express.static(uploadsDir, {
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    if (/\.(xml|svg|html|htm|xhtml)$/i.test(filePath)) {
      res.setHeader('Content-Disposition', 'attachment');
    }
  },
}));

void applyRetentionPolicy(prisma).catch((error: unknown) => console.error('[retention] Błąd polityki terminu życia:', errorMessage(error)));
setInterval(() => {
  void applyRetentionPolicy(prisma).catch((error: unknown) => console.error('[retention] Błąd polityki terminu życia:', errorMessage(error)));
}, 60_000);

// Check at startup and every minute so a missed scheduled backup can run later.
const checkScheduledBackups = createBackupScheduler(prisma, runScheduledCloudBackup);
const checkBackupsSafely = () => { void checkScheduledBackups().catch(error => console.error('[backup] Scheduler:', errorMessage(error))); };
checkBackupsSafely();
cron.schedule('* * * * *', checkBackupsSafely);

const cleanupUploadsSafely = () => {
  try {
    const removed = cleanupExpiredResumableSessions();
    if (removed > 0) console.log(`[uploads] Usunięto osierocone sesje uploadu: ${removed}`);
  } catch (error) {
    console.error('[uploads] Cleanup:', errorMessage(error));
  }
};
cleanupUploadsSafely();
cron.schedule('0 * * * *', cleanupUploadsSafely);

app.use('/api/account-security', createAccountSecurityRouter(prisma));
app.use('/api/folders', createFolderRouter(prisma));

app.use('/api/printer-scan', createPrinterScanRouter(prisma));
app.use('/api/ocr', createOcrRouter(prisma, ocrQueue));

app.use('/api/tags', createTagRouter(prisma));
app.use('/api/billing', createBillingRouter(prisma));
app.use('/api/dev/plan', createDevPlanRouter());
app.use('/api/backup', createBackupRouter(prisma));
app.use('/api/feedback', createFeedbackRouter());
app.use('/api/folder-vault', createFolderVaultRouter(prisma));
app.use('/api/documents', createDocumentRouter(prisma, ocrQueue));
app.use('/api/analytics', createAnalyticsRouter(prisma));
app.use('/api/family', createFamilyRouter(prisma));
app.use('/api/tester-consent', createTesterConsentRouter(prisma));
app.use('/api/archive-workspace', createArchiveWorkspaceRouter());
app.use('/api/secure-shares', createSecureShareRouter(prisma));
app.use('/api/sync', createSyncRouter(prisma));
app.use('/api', createMobileScanRouter(prisma, ocrQueue));

app.use('/api/scanner', createScannerInboxRouter(prisma, ocrQueue));
app.use('/api/mail-inbox', createMailInboxRouter(prisma, ocrQueue));
app.use('/api/automation', createAutomationRouter(prisma));
app.use('/api/ksef', createKsefRouter(prisma));
cron.schedule('15 7 * * *', () => {
  for (const scheduledOwner of listScheduledKsefOwners()) {
    void syncKsefInvoices(prisma, scheduledOwner, 7).catch(err => console.error(`[ksef] Daily sync failed for user ${scheduledOwner}:`, errorMessage(err)));
  }
});

if (hasFrontendBundle) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) { next(); return; }
    res.sendFile(path.join(frontendDistDir, 'index.html'));
  });
}

const logStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
};

// ==========================================
// GLOBALNA PUŁAPKA NA NIEPRZEWIDZIANE BŁĘDY (CRASH CATCHER)
// ==========================================
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const details = errorMessage(err);
  const ts = logStamp();
  console.error(`${ts} !!! KRYTYCZNY BŁĄD SERWERA !!! Ścieżka:`, req.url);
  console.error(`${ts} Szczegóły:`, details);
  res.status(500).json({
    error: "Krytyczny błąd serwera",
    ...(process.env.NODE_ENV === 'production' ? {} : { details }),
  });
});

const httpBindHost = process.env.MOJATECZKA_PUBLIC_TEST_MODE === '1' ? '0.0.0.0' : '127.0.0.1';
void prisma.$executeRawUnsafe("UPDATE Document SET filePath = substr(filePath, 9) WHERE filePath LIKE 'uploads/%'").catch(() => undefined);
const pruneTechnicalTables = async () => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  await prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => undefined);
  await prisma.syncOperation.deleteMany({ where: { createdAt: { lt: thirtyDaysAgo } } }).catch(() => undefined);
};
void pruneTechnicalTables();
setInterval(() => { void pruneTechnicalTables(); }, 6 * 3_600_000).unref();

const httpServer = app.listen(3000, httpBindHost, () => { console.log(`${logStamp()} Serwer lokalny HTTP: port 3000 (${httpBindHost}).`); void ocrQueue.process().catch(() => console.error(`${logStamp()} [ocr] Nie udało się wznowić kolejki.`)); });
const httpsServer = https.createServer({ key: localTls.key, cert: localTls.cert, minVersion: 'TLSv1.2' }, app);
httpsServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && process.env.MOJATECZKA_PUBLIC_TEST_MODE === '1') {
    console.warn(`${logStamp()} [tls] Port 3443 zajęty — w trybie testowym WWW ruch idzie przez port 3000.`);
    return;
  }
  throw err;
});
httpsServer.listen(3443, '0.0.0.0', () => console.log(`${logStamp()} Bezpieczne połączenia HTTPS: port 3443.`));
attachRealtimeServer([httpServer, httpsServer], prisma, isAllowedCorsOrigin, resolvePairedDeviceOwner);

const shutdownBackend = (signal: string) => {
  console.log(`${logStamp()} Otrzymano sygnał ${signal}, zamykanie serwerów…`);
  closeRealtimeServer();
  httpServer.close(() => undefined);
  httpsServer.close(() => undefined);
  void prisma.$disconnect().finally(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.once('SIGTERM', () => shutdownBackend('SIGTERM'));
process.once('SIGINT', () => shutdownBackend('SIGINT'));
