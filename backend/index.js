"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const client_1 = require("@prisma/client");
const paths_1 = require("./config/paths");
const retention_1 = require("./services/retention");
const accessControl_1 = require("./middleware/accessControl");
const tags_1 = require("./routes/tags");
const folders_1 = require("./routes/folders");
const printerScan_1 = require("./routes/printerScan");
const documents_1 = require("./routes/documents");
const sync_1 = require("./routes/sync");
const mobileScan_1 = require("./routes/mobileScan");
const errors_1 = require("./utils/errors");
const billing_1 = require("./routes/billing");
const premium_1 = require("./middleware/premium");
const auth_1 = require("./routes/auth");
const backup_1 = require("./routes/backup");
const prisma = new client_1.PrismaClient();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
(0, accessControl_1.registerPairingRoutes)(app);
app.use('/api/auth', (0, auth_1.createAuthRouter)(prisma));
app.post('/api/billing/webhook', express_1.default.raw({ type: 'application/json' }), (0, billing_1.createBillingWebhookHandler)(prisma));
app.use('/api', accessControl_1.requireAccess);
app.use('/uploads', accessControl_1.requireAccess, express_1.default.static(paths_1.uploadsDir));
app.use(accessControl_1.requireAccess, express_1.default.static(paths_1.uploadsDir));
void (0, retention_1.applyRetentionPolicy)(prisma).catch((error) => console.error('[retention] Błąd polityki terminu życia:', (0, errors_1.errorMessage)(error)));
setInterval(() => {
    void (0, retention_1.applyRetentionPolicy)(prisma).catch((error) => console.error('[retention] Błąd polityki terminu życia:', (0, errors_1.errorMessage)(error)));
}, 60000);
app.use('/api/folders', (0, folders_1.createFolderRouter)(prisma));
app.use('/api/printer-scan', (0, premium_1.requirePremium)(prisma), (0, printerScan_1.createPrinterScanRouter)(prisma));
app.use('/api/tags', (0, tags_1.createTagRouter)(prisma));
app.use('/api/billing', (0, billing_1.createBillingRouter)(prisma));
app.use('/api/backup', (0, backup_1.createBackupRouter)(prisma));
app.use('/api/documents', (0, documents_1.createDocumentRouter)(prisma));
app.use('/api/sync', (0, sync_1.createSyncRouter)(prisma));
app.use('/api', (0, mobileScan_1.createMobileScanRouter)(prisma));
app.get('/api/scanner', (req, res) => { res.json([]); });
// ==========================================
// GLOBALNA PUŁAPKA NA NIEPRZEWIDZIANE BŁĘDY (CRASH CATCHER)
// ==========================================
app.use((err, req, res, _next) => {
    const details = (0, errors_1.errorMessage)(err);
    console.error("!!! KRYTYCZNY BŁĄD SERWERA !!! Ścieżka:", req.url);
    console.error("Szczegóły:", details);
    res.status(500).json({ error: "Krytyczny błąd serwera", details });
});
app.listen(3000, '0.0.0.0', () => { console.log('✅ SERVER BACKEND DZIALA NA PORCIE 3000'); });
