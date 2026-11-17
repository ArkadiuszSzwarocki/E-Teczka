"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const accountSecurity_1 = require("./routes/accountSecurity");
const sessionPolicy_1 = require("./services/sessionPolicy");
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const paths_1 = require("./config/paths");
const node_path_1 = __importDefault(require("node:path"));
const node_https_1 = __importDefault(require("node:https"));
const localTls_1 = require("./services/localTls");
const requireSecureRemote_1 = require("./middleware/requireSecureRemote");
const retention_1 = require("./services/retention");
const accessControl_1 = require("./middleware/accessControl");
const node_crypto_1 = require("node:crypto");
const tags_1 = require("./routes/tags");
const folders_1 = require("./routes/folders");
const printerScan_1 = require("./routes/printerScan");
const scannerInbox_1 = require("./routes/scannerInbox");
const documents_1 = require("./routes/documents");
const sync_1 = require("./routes/sync");
const mobileScan_1 = require("./routes/mobileScan");
const errors_1 = require("./utils/errors");
const billing_1 = require("./routes/billing");
const auth_1 = require("./routes/auth");
const helloAuth_1 = require("./routes/helloAuth");
const centralEntitlements_1 = require("./services/centralEntitlements");
const centralPlanLedger_1 = require("./services/centralPlanLedger");
const backup_1 = require("./routes/backup");
const folderVault_1 = require("./routes/folderVault");
const node_cron_1 = __importDefault(require("node-cron"));
const backup_2 = require("./routes/backup");
const backupScheduler_1 = require("./services/backupScheduler");
const ocrQueue_1 = require("./services/ocrQueue");
const ocr_1 = require("./routes/ocr");
const planLedger_1 = require("./services/planLedger");
const planCatalog_1 = require("./services/planCatalog");
const developerCatalog_1 = require("./routes/developerCatalog");
const devPlans_1 = require("./routes/devPlans");
const secureShare_1 = require("./routes/secureShare");
const centralAccount_1 = require("./routes/centralAccount");
const archiveWorkspace_1 = require("./routes/archiveWorkspace");
const feedback_1 = require("./routes/feedback");
const analytics_1 = require("./routes/analytics");
const family_1 = require("./routes/family");
const testerConsent_1 = require("./routes/testerConsent");
const legal_1 = require("./routes/legal");
const appVersion_1 = require("./routes/appVersion");
const node_fs_1 = __importDefault(require("node:fs"));
const prisma = new client_1.PrismaClient();
void prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;').catch(() => undefined);
void prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;').catch(() => undefined);
(0, centralPlanLedger_1.instrumentPlanTransactions)(prisma);
const idlePolicyReady = (0, sessionPolicy_1.ensureIdleSessionPolicy)(prisma);
(0, accessControl_1.configureAccountSessionValidator)((token, userId) => __awaiter(void 0, void 0, void 0, function* () { return Boolean(yield prisma.authSession.findFirst({ where: Object.assign({ tokenHash: (0, node_crypto_1.createHash)('sha256').update(token).digest('hex'), userId }, (0, sessionPolicy_1.activeSessionWhere)()), select: { id: true } })); }));
const app = (0, express_1.default)();
const ocrQueue = (0, ocrQueue_1.createOcrQueue)(prisma, { file: node_path_1.default.join(paths_1.securityDir, 'ocr-queue.enc'), uploadsDirectory: paths_1.uploadsDir });
const localTls = (0, localTls_1.makeLocalTls)(paths_1.securityDir);
app.use((0, cors_1.default)());
// Local desktop can keep using loopback HTTP. Remote clients must use TLS;
// never redirect bearer tokens or pairing codes after receiving them over HTTP.
// The public certificate contains no credentials. Its fingerprint is verified
// against the QR code before it is saved or trusted on the phone.
app.get('/api/pairing-certificate', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/plain').send(localTls.caPem);
});
app.use(requireSecureRemote_1.requireSecureRemote);
app.get('/api/local-ca', (req, res) => {
    const peer = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer))
        return res.sendStatus(403);
    res.setHeader('Content-Disposition', 'attachment; filename=E-Teczka-local-CA.crt');
    res.type('application/x-x509-ca-cert').send(localTls.caPem);
});
app.get('/api/local-ca-info', (req, res) => {
    const peer = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer))
        return res.sendStatus(403);
    res.json({ fingerprint: localTls.fingerprint });
});
// Stripe verifies the signature against the original bytes of the request.
// Register this route before the JSON parser consumes the request body.
app.post('/api/billing/webhook', express_1.default.raw({ type: 'application/json' }), (0, billing_1.createBillingWebhookHandler)(prisma));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api', (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () { try {
    yield idlePolicyReady;
    next();
}
catch (_a) {
    res.status(503).json({ error: 'Nie udało się przygotować sesji.' });
} }));
(0, accessControl_1.registerPairingRoutes)(app, (owner) => __awaiter(void 0, void 0, void 0, function* () { return (0, planCatalog_1.getCatalog)().plans[yield (0, planLedger_1.getPlan)(prisma, owner)].mobileDevices; }));
app.use('/api/auth', (0, auth_1.createAuthRouter)(prisma));
app.use('/api/hello', (0, helloAuth_1.createHelloAuthRouter)(prisma));
// The bridge accepts central credentials only from this computer. Linking is
// explicit and requires a live local session as well as a central session.
app.use('/api/central-account', accessControl_1.requireLocalDesktop, (0, centralAccount_1.createCentralAccountRouter)(prisma));
app.use('/api/backup/oauth', (0, backup_1.createBackupOAuthCallbackRouter)(prisma));
app.use('/api/dev/catalog', (0, developerCatalog_1.createDeveloperCatalogRouter)(prisma));
app.use('/api/dev/feedback', (0, feedback_1.createDeveloperFeedbackRouter)());
app.use('/api/legal', (0, legal_1.createLegalRouter)());
app.use('/api/app-version', (0, appVersion_1.createAppVersionRouter)());
const mobileTestApkPath = node_path_1.default.resolve(__dirname, '../ETeczkaMobile/android/app/build/outputs/apk/debug/app-debug.apk');
const mobileTestApkAllowed = () => (process.env.ETECZKA_PUBLIC_TEST_MODE === '1' || process.env.ETECZKA_DEV_PLANS === '1') && process.env.NODE_ENV !== 'production' && node_fs_1.default.existsSync(mobileTestApkPath);
app.get('/api/mobile-app/status', (_req, res) => {
    if (!mobileTestApkAllowed())
        return res.json({ available: false });
    const sizeMb = Math.round((node_fs_1.default.statSync(mobileTestApkPath).size / (1024 * 1024)) * 10) / 10;
    return res.json({ available: true, path: '/api/mobile-app/download', sizeMb });
});
app.get('/api/mobile-app/download', (_req, res) => {
    if (!mobileTestApkAllowed())
        return res.status(404).json({ error: 'Plik instalacyjny testowy nie jest dostępny.' });
    res.download(mobileTestApkPath, 'E-Teczka-test.apk');
});
const centralDeviceGate = (_req, res, next) => __awaiter(void 0, void 0, void 0, function* () { if (res.locals.userId) {
    const state = yield (0, centralEntitlements_1.centralEntitlement)(Number(res.locals.userId));
    if (state === null || state === void 0 ? void 0 : state.blocked)
        return res.status(403).json({ code: 'DEVICE_REVOKED', error: 'To urządzenie nie ma już uprawnień do konta. Zaloguj się ponownie lub sprawdź urządzenia na stronie konta.' });
} next(); });
const frontendDistDir = node_path_1.default.resolve(__dirname, '../frontend/dist');
const hasFrontendBundle = node_fs_1.default.existsSync(node_path_1.default.join(frontendDistDir, 'index.html'));
if (hasFrontendBundle) {
    app.use(express_1.default.static(frontendDistDir));
}
app.use('/api', accessControl_1.requireAccess, centralDeviceGate);
app.use('/uploads', accessControl_1.requireAccess, centralDeviceGate, express_1.default.static(paths_1.uploadsDir));
app.use(accessControl_1.requireAccess, centralDeviceGate, express_1.default.static(paths_1.uploadsDir));
void (0, retention_1.applyRetentionPolicy)(prisma).catch((error) => console.error('[retention] Błąd polityki terminu życia:', (0, errors_1.errorMessage)(error)));
setInterval(() => {
    void (0, retention_1.applyRetentionPolicy)(prisma).catch((error) => console.error('[retention] Błąd polityki terminu życia:', (0, errors_1.errorMessage)(error)));
}, 60000);
// Check at startup and every minute so a missed scheduled backup can run later.
const checkScheduledBackups = (0, backupScheduler_1.createBackupScheduler)(prisma, backup_2.runScheduledCloudBackup);
const checkBackupsSafely = () => { void checkScheduledBackups().catch(error => console.error('[backup] Scheduler:', (0, errors_1.errorMessage)(error))); };
checkBackupsSafely();
node_cron_1.default.schedule('* * * * *', checkBackupsSafely);
app.use('/api/account-security', (0, accountSecurity_1.createAccountSecurityRouter)(prisma));
app.use('/api/folders', (0, folders_1.createFolderRouter)(prisma));
app.use('/api/printer-scan', (0, printerScan_1.createPrinterScanRouter)(prisma));
app.use('/api/ocr', (0, ocr_1.createOcrRouter)(prisma, ocrQueue));
app.use('/api/tags', (0, tags_1.createTagRouter)(prisma));
app.use('/api/billing', (0, billing_1.createBillingRouter)(prisma));
app.use('/api/dev/plan', (0, devPlans_1.createDevPlanRouter)());
app.use('/api/backup', (0, backup_1.createBackupRouter)(prisma));
app.use('/api/feedback', (0, feedback_1.createFeedbackRouter)());
app.use('/api/folder-vault', (0, folderVault_1.createFolderVaultRouter)(prisma));
app.use('/api/documents', (0, documents_1.createDocumentRouter)(prisma, ocrQueue));
app.use('/api/analytics', (0, analytics_1.createAnalyticsRouter)(prisma));
app.use('/api/family', (0, family_1.createFamilyRouter)(prisma));
app.use('/api/tester-consent', (0, testerConsent_1.createTesterConsentRouter)(prisma));
app.use('/api/archive-workspace', (0, archiveWorkspace_1.createArchiveWorkspaceRouter)());
app.use('/api/secure-shares', (0, secureShare_1.createSecureShareRouter)(prisma));
app.use('/api/sync', (0, sync_1.createSyncRouter)(prisma));
app.use('/api', (0, mobileScan_1.createMobileScanRouter)(prisma, ocrQueue));
app.use('/api/scanner', (0, scannerInbox_1.createScannerInboxRouter)(prisma, ocrQueue));
if (hasFrontendBundle) {
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
            next();
            return;
        }
        res.sendFile(node_path_1.default.join(frontendDistDir, 'index.html'));
    });
}
// ==========================================
// GLOBALNA PUŁAPKA NA NIEPRZEWIDZIANE BŁĘDY (CRASH CATCHER)
// ==========================================
app.use((err, req, res, _next) => {
    const details = (0, errors_1.errorMessage)(err);
    console.error("!!! KRYTYCZNY BŁĄD SERWERA !!! Ścieżka:", req.url);
    console.error("Szczegóły:", details);
    res.status(500).json({ error: "Krytyczny błąd serwera", details });
});
app.listen(3000, '0.0.0.0', () => { console.log('Serwer lokalny HTTP: port 3000 (tylko komputer).'); void ocrQueue.process().catch(() => console.error('[ocr] Nie udało się wznowić kolejki.')); });
const httpsServer = node_https_1.default.createServer({ key: localTls.key, cert: localTls.cert, minVersion: 'TLSv1.2' }, app);
httpsServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && process.env.ETECZKA_PUBLIC_TEST_MODE === '1') {
        console.warn('[tls] Port 3443 zajęty — w trybie testowym WWW ruch idzie przez port 3000.');
        return;
    }
    throw err;
});
httpsServer.listen(3443, '0.0.0.0', () => console.log('Bezpieczne połączenia HTTPS: port 3443.'));
