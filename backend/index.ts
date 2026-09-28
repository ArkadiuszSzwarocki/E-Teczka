import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { uploadsDir } from './config/paths';
import { applyRetentionPolicy } from './services/retention';
import { registerPairingRoutes, requireAccess } from './middleware/accessControl';
import { createTagRouter } from './routes/tags';
import { createFolderRouter } from './routes/folders';
import { createPrinterScanRouter } from './routes/printerScan';
import { createDocumentRouter } from './routes/documents';
import { createSyncRouter } from './routes/sync';
import { createMobileScanRouter } from './routes/mobileScan';
import { errorMessage } from './utils/errors';
import { createBillingRouter, createBillingWebhookHandler } from './routes/billing';
import { requirePremium } from './middleware/premium';
import { createAuthRouter } from './routes/auth';
import { createBackupRouter } from './routes/backup';

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

registerPairingRoutes(app);
app.use('/api/auth', createAuthRouter(prisma));

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), createBillingWebhookHandler(prisma));

app.use('/api', requireAccess);
app.use('/uploads', requireAccess, express.static(uploadsDir));
app.use(requireAccess, express.static(uploadsDir));

void applyRetentionPolicy(prisma).catch((error: unknown) => console.error('[retention] Błąd polityki terminu życia:', errorMessage(error)));
setInterval(() => {
  void applyRetentionPolicy(prisma).catch((error: unknown) => console.error('[retention] Błąd polityki terminu życia:', errorMessage(error)));
}, 60_000);

app.use('/api/folders', createFolderRouter(prisma));

app.use('/api/printer-scan', requirePremium(prisma), createPrinterScanRouter(prisma));

app.use('/api/tags', createTagRouter(prisma));
app.use('/api/billing', createBillingRouter(prisma));
app.use('/api/backup', createBackupRouter(prisma));
app.use('/api/documents', createDocumentRouter(prisma));
app.use('/api/sync', createSyncRouter(prisma));
app.use('/api', createMobileScanRouter(prisma));

app.get('/api/scanner', (req, res) => { res.json([]); });

// ==========================================
// GLOBALNA PUŁAPKA NA NIEPRZEWIDZIANE BŁĘDY (CRASH CATCHER)
// ==========================================
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const details = errorMessage(err);
  console.error("!!! KRYTYCZNY BŁĄD SERWERA !!! Ścieżka:", req.url);
  console.error("Szczegóły:", details);
  res.status(500).json({ error: "Krytyczny błąd serwera", details });
});

app.listen(3000, '0.0.0.0', () => { console.log('✅ SERVER BACKEND DZIALA NA PORCIE 3000'); });
