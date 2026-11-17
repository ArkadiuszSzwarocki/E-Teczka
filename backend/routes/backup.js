"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.runScheduledCloudBackup = runScheduledCloudBackup;
exports.createBackupRouter = createBackupRouter;
exports.createBackupOAuthCallbackRouter = createBackupOAuthCallbackRouter;
const express_1 = __importDefault(require("express"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const archiver = __importStar(require("archiver"));
const multer_1 = __importDefault(require("multer"));
const premium_1 = require("../middleware/premium");
const planLedger_1 = require("../services/planLedger");
const ocrPremium_1 = require("../services/ocrPremium");
const backupCrypto_1 = require("../services/backupCrypto");
const accessControl_1 = require("../middleware/accessControl");
const restoreBackup_1 = require("../services/restoreBackup");
const externalImport_1 = require("../services/externalImport");
const webdavFolders_1 = require("../services/webdavFolders");
const webdavCertificate_1 = require("../services/webdavCertificate");
const backupMfa_1 = require("./backupMfa");
const cloudBackupTransfer_1 = require("../services/cloudBackupTransfer");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res) => Number(res.locals.userId || 1);
const allowedProviders = new Set(['webdav', 'google-drive', 'onedrive', 'dropbox']);
const oauthStates = new Map();
function isPremium(prisma, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const req = res.req;
        const start = req.method !== 'GET' || req.path.startsWith('/oauth/');
        return (yield (0, planLedger_1.featureTrial)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res), 'cloudBackup', start)).allowed;
    });
}
/** Executes a scheduled backup for an owner. ownerId is the document owner id. */
function runScheduledCloudBackup(prisma, ownerKey, ownerIdValue) {
    return __awaiter(this, void 0, void 0, function* () {
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled) || !destination.schedule || destination.schedule === 'manual')
            return false;
        const credentials = destination.provider === 'webdav'
            ? (destination.encryptedCredentials ? JSON.parse((0, backupCrypto_1.decrypt)(destination.encryptedCredentials)) : {})
            : yield (0, cloudBackupTransfer_1.refreshOAuthCredentials)(prisma, destination);
        if (destination.provider === 'webdav' && (credentials.purpose !== 'backup-only' || !credentials.username || !credentials.password)) {
            throw new Error('Skonfiguruj osobne konto NAS przeznaczone do automatycznej kopii.');
        }
        const data = yield (0, cloudBackupTransfer_1.buildEncryptedBackupBuffer)(prisma, ownerIdValue, ownerKey);
        const response = yield (0, cloudBackupTransfer_1.uploadEncryptedBackupToCloud)(destination, credentials, data);
        if (!response.ok)
            throw new Error(`Cloud upload failed (${response.status}).`);
        return true;
    });
}
function createBackupRouter(prisma) {
    const router = express_1.default.Router();
    router.use('/authenticator', (0, backupMfa_1.createBackupMfaRouter)(prisma));
    router.post('/recovery-key', accessControl_1.requireLocalDesktop, (0, backupMfa_1.requireBackupMfa)('recovery-key'), (req, res) => {
        var _a;
        try {
            const passphrase = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.passphrase) === 'string' ? req.body.passphrase : '';
            if (passphrase.length > 1024)
                return res.status(400).json({ error: 'Hasło jest zbyt długie.' });
            res.setHeader('Cache-Control', 'no-store');
            res.type('application/json').send((0, backupCrypto_1.exportRecoveryKey)(passphrase));
        }
        catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się utworzyć klucza.' });
        }
    });
    router.post('/webdav/folders', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
        const connection = { endpoint: String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.endpoint) || ''), username: String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.username) || ''), password: String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.password) || '') };
        const folder = String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.folder) || '');
        try {
            if (!connection.username || !connection.password)
                return res.status(400).json({ error: 'Podaj użytkownika i hasło NAS, aby przeglądać foldery.' });
            if (((_e = req.body) === null || _e === void 0 ? void 0 : _e.createName) !== undefined)
                yield (0, webdavFolders_1.createWebDavFolder)(connection, folder, String(req.body.createName));
            res.json({ folders: yield (0, webdavFolders_1.listWebDavFolders)(connection, folder) });
        }
        catch (error) {
            const cause = error instanceof Error ? error.cause : undefined;
            if ((cause === null || cause === void 0 ? void 0 : cause.code) === 'ERR_TLS_CERT_ALTNAME_INVALID') {
                const suggestedEndpoint = yield (0, webdavCertificate_1.suggestNasHostname)((0, webdavFolders_1.normalizeWebDavEndpoint)(connection.endpoint));
                return res.status(502).json({ error: suggestedEndpoint ? 'Certyfikat NAS-a nie obejmuje adresu IP. Znaleziono zweryfikowaną nazwę tego serwera.' : 'Certyfikat NAS-a nie obejmuje tego adresu IP. Użyj nazwy serwera zgodnej z certyfikatem.', suggestedEndpoint });
            }
            res.status(502).json({ error: error instanceof Error && !/fetch|network|certificate|redirect/i.test(error.message) ? error.message : 'Nie udało się połączyć z WebDAV. Sprawdź adres HTTPS, certyfikat i dostępność serwera.' });
        }
    }));
    router.get('/oauth/:provider/start', (0, backupMfa_1.requireBackupMfa)('oauth'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
        const provider = String(req.params.provider);
        const config = cloudBackupTransfer_1.oauthConfig[provider];
        if (!config || !config.clientId || !config.clientSecret)
            return res.status(503).json({ error: `Brak konfiguracji OAuth dla ${provider}.` });
        const state = node_crypto_1.default.randomBytes(24).toString('base64url');
        oauthStates.set(state, { ownerKey: (0, premium_1.billingOwnerKey)(res), provider, expiresAt: Date.now() + 10 * 60000 });
        const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: (0, cloudBackupTransfer_1.oauthCallbackUrl)(), response_type: 'code', state, scope: config.scope });
        if (provider === 'google-drive')
            params.set('access_type', 'offline');
        if (provider === 'dropbox')
            params.set('token_access_type', 'offline');
        const url = `${config.authorize}?${params.toString()}`;
        if (req.query.mode === 'json')
            return res.json({ url });
        res.redirect(url);
    }));
    router.get('/destination', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        let backupUsername = '';
        let backupCredentialSaved = false;
        if ((destination === null || destination === void 0 ? void 0 : destination.provider) === 'webdav' && destination.encryptedCredentials) {
            try {
                const credentials = JSON.parse((0, backupCrypto_1.decrypt)(destination.encryptedCredentials));
                if (credentials.purpose === 'backup-only') {
                    backupUsername = credentials.username || '';
                    backupCredentialSaved = Boolean(credentials.password);
                }
            }
            catch (_a) {
                return res.status(500).json({ error: 'Nie udało się odczytać ustawień konta kopii.' });
            }
        }
        res.json(destination ? { provider: destination.provider, endpoint: destination.endpoint, backupUsername, backupCredentialSaved, remoteFolder: destination.remoteFolder, schedule: destination.schedule, lastBackupAt: destination.lastBackupAt, lastBackupStatus: destination.lastBackupStatus, lastBackupError: destination.lastBackupError, enabled: destination.enabled, configured: true } : { configured: false });
    }));
    router.get('/runs', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Historia kopii wymaga planu Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) }, select: { id: true } });
        if (!destination)
            return res.json([]);
        res.json(yield prisma.backupRun.findMany({ where: { destinationId: destination.id }, orderBy: { startedAt: 'desc' }, take: 50 }));
    }));
    router.put('/destination', (0, backupMfa_1.requireBackupMfa)('destination'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
        const provider = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.provider) || '');
        let endpoint = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.endpoint) === 'string' ? req.body.endpoint.trim().slice(0, 2000) : '';
        const remoteFolder = typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.remoteFolder) === 'string' ? req.body.remoteFolder.trim().slice(0, 500) : '';
        const schedule = String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.schedule) || 'manual');
        if (!/^(manual|on_login|on_logout|(?:daily|weekly)(?:@(?:[01]\d|2[0-3]):[0-5]\d)?)$/.test(schedule))
            return res.status(400).json({ error: 'Nieprawidłowy harmonogram kopii.' });
        const username = typeof ((_e = req.body) === null || _e === void 0 ? void 0 : _e.username) === 'string' ? req.body.username.trim() : '';
        const nasPassword = typeof ((_f = req.body) === null || _f === void 0 ? void 0 : _f.password) === 'string' ? req.body.password : '';
        const backupUsername = typeof ((_g = req.body) === null || _g === void 0 ? void 0 : _g.backupUsername) === 'string' ? req.body.backupUsername.trim() : '';
        const backupPassword = typeof ((_h = req.body) === null || _h === void 0 ? void 0 : _h.backupPassword) === 'string' ? req.body.backupPassword : '';
        if (!allowedProviders.has(provider))
            return res.status(400).json({ error: 'Nieobsługiwany dostawca chmury.' });
        if (provider === 'webdav') {
            try {
                endpoint = (0, webdavFolders_1.normalizeWebDavEndpoint)(endpoint);
            }
            catch (error) {
                return res.status(400).json({ error: error instanceof Error ? error.message : 'Nieprawidłowy adres serwera NAS.' });
            }
        }
        const existing = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        let credentials = null;
        if (provider === 'webdav') {
            if (!username)
                return res.status(400).json({ error: 'Podaj nazwę swojego konta NAS.' });
            if (schedule !== 'manual') {
                const effectiveUser = backupUsername || username;
                const effectivePass = backupPassword || nasPassword;
                if (effectivePass) {
                    const purpose = backupUsername && backupUsername.toLowerCase() !== username.toLowerCase() ? 'backup-only' : 'nas-auto';
                    credentials = (0, backupCrypto_1.encrypt)(JSON.stringify({ username: effectiveUser, password: effectivePass, purpose }));
                }
                else {
                    if (!existing || existing.provider !== 'webdav' || !existing.encryptedCredentials || !existing.endpoint || (0, webdavFolders_1.normalizeWebDavEndpoint)(existing.endpoint) !== endpoint)
                        return res.status(400).json({ error: 'Podaj hasło NAS, aby zapisać automatyczną kopię.' });
                    const saved = JSON.parse((0, backupCrypto_1.decrypt)(existing.encryptedCredentials));
                    if (saved.username !== effectiveUser || !saved.password)
                        return res.status(400).json({ error: 'Podaj hasło NAS, aby zapisać automatyczną kopię.' });
                    credentials = existing.encryptedCredentials;
                }
            }
        }
        else if ((existing === null || existing === void 0 ? void 0 : existing.provider) === provider)
            credentials = existing.encryptedCredentials;
        const destination = yield prisma.backupDestination.upsert({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) }, create: { ownerKey: (0, premium_1.billingOwnerKey)(res), provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials }, update: { provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials, enabled: true } });
        res.json({ provider: destination.provider, endpoint: destination.endpoint, remoteFolder: destination.remoteFolder, schedule: destination.schedule, enabled: destination.enabled, configured: true });
    }));
    router.post('/cloud', (0, backupMfa_1.requireBackupMfa)('cloud'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        const isAuto = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.auto) === true;
        if (destination.provider === 'webdav' && !isAuto && (!((_b = req.body) === null || _b === void 0 ? void 0 : _b.username) || !((_c = req.body) === null || _c === void 0 ? void 0 : _c.password)))
            return res.status(400).json({ error: 'Podaj swoje dane logowania NAS do ręcznej kopii.' });
        if (destination.provider === 'webdav' && isAuto && !destination.encryptedCredentials)
            return res.status(400).json({ error: 'Brak zapisanego konta NAS do automatycznej kopii.' });
        try {
            const credentials = destination.provider === 'webdav'
                ? (isAuto && destination.encryptedCredentials ? JSON.parse((0, backupCrypto_1.decrypt)(destination.encryptedCredentials)) : { username: String(req.body.username), password: String(req.body.password) })
                : yield (0, cloudBackupTransfer_1.refreshOAuthCredentials)(prisma, destination);
            const data = yield (0, cloudBackupTransfer_1.buildEncryptedBackupBuffer)(prisma, ownerId(res), (0, ocrPremium_1.ocrOwnerKey)(res));
            const response = yield (0, cloudBackupTransfer_1.uploadEncryptedBackupToCloud)(destination, credentials, data);
            if (!response.ok)
                return res.status(502).json({ error: response.status === 507 ? 'NAS zgłosił brak dostępnego miejsca (HTTP 507). Sprawdź wolne miejsce, limit konta oraz czy wybrano właściwy folder z prawem zapisu.' : `Serwer ${destination.provider === 'webdav' ? 'NAS/WebDAV' : destination.provider} odrzucił kopię (HTTP ${response.status}). Sprawdź folder i uprawnienia do zapisu.` });
            res.json({ success: true, provider: destination.provider, uploadedAt: new Date().toISOString() });
        }
        catch (error) {
            console.error('[backup] cloud upload:', error);
            res.status(502).json({ error: error instanceof Error && error.message.startsWith('Brak pliku dokumentu') ? error.message : 'Nie udało się utworzyć lub wysłać kopii. Sprawdź log serwera.' });
        }
    }));
    router.post('/cloud/list', (0, backupMfa_1.requireBackupMfa)('cloud/latest'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        if (destination.provider === 'webdav' && (!((_a = req.body) === null || _a === void 0 ? void 0 : _a.username) || !((_b = req.body) === null || _b === void 0 ? void 0 : _b.password)))
            return res.status(400).json({ error: 'Podaj swoje dane logowania NAS, aby wyświetlić kopie.' });
        try {
            const credentials = destination.provider === 'webdav' ? { username: String(req.body.username), password: String(req.body.password) } : yield (0, cloudBackupTransfer_1.refreshOAuthCredentials)(prisma, destination);
            const result = yield (0, cloudBackupTransfer_1.listCloudBackups)(destination, credentials);
            if (!result.ok)
                return res.status(result.status).json({ error: result.error });
            res.json({ backups: result.backups });
        }
        catch (error) {
            console.error('[backup] cloud list:', error);
            res.status(502).json({ error: 'Nie udało się pobrać listy kopii.' });
        }
    }));
    router.post('/cloud/latest', (0, backupMfa_1.requireBackupMfa)('cloud/latest'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        if (destination.provider === 'webdav' && (!((_a = req.body) === null || _a === void 0 ? void 0 : _a.username) || !((_b = req.body) === null || _b === void 0 ? void 0 : _b.password)))
            return res.status(400).json({ error: 'Podaj swoje dane logowania NAS, aby pobrać kopię.' });
        try {
            const requested = typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.filename) === 'string' ? req.body.filename.trim() : '';
            if (requested && (!requested.toLowerCase().endsWith('.zip.enc') || requested.includes('/') || requested.includes('\\') || requested === '..')) {
                return res.status(400).json({ error: 'Nieprawidłowa nazwa kopii.' });
            }
            const credentials = destination.provider === 'webdav' ? { username: String(req.body.username), password: String(req.body.password) } : yield (0, cloudBackupTransfer_1.refreshOAuthCredentials)(prisma, destination);
            const result = yield (0, cloudBackupTransfer_1.downloadCloudBackup)(destination, credentials, requested);
            if (!result.ok)
                return res.status(result.status).json({ error: result.error });
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="eteczka-cloud-backup.zip.enc"');
            res.send(result.buffer);
        }
        catch (error) {
            console.error('[backup] cloud download:', error);
            res.status(502).json({ error: 'Nie udało się pobrać kopii z chmury.' });
        }
    }));
    router.get('/export', (0, backupMfa_1.requireBackupMfa)('export'), (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            const { manifest, files } = yield (0, cloudBackupTransfer_1.buildBackupArchive)(prisma, ownerId(res), (0, ocrPremium_1.ocrOwnerKey)(res));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
            const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
            archive.on('error', (error) => { if (!res.headersSent)
                res.status(500); res.end(); console.error('[backup] export:', error); });
            archive.pipe(res);
            archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
            for (const file of files)
                archive.file(file.source, { name: file.archiveName });
            yield archive.finalize();
        }
        catch (error) {
            return res.status(409).json({ error: error instanceof Error ? error.message : 'Brak pliku dokumentu.' });
        }
    }));
    router.post('/restore', (0, backupMfa_1.requireBackupMfa)('restore'), upload.single('backup'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!req.file)
            return res.status(400).json({ error: 'Wybierz plik kopii zapasowej.' });
        if (((_a = req.body) === null || _a === void 0 ? void 0 : _a.restoreMode) !== 'replace')
            return res.status(400).json({ error: 'Przywracanie zastępuje aktualne dane. Potwierdź tę operację w aktualnej wersji aplikacji.' });
        try {
            let recoveryKey;
            if ((_b = req.body) === null || _b === void 0 ? void 0 : _b.recoveryKey) {
                const address = req.socket.remoteAddress || '';
                if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address))
                    return res.status(403).json({ error: 'Klucz odzyskiwania można użyć tylko na komputerze.' });
                recoveryKey = (0, backupCrypto_1.importRecoveryKey)(String(req.body.recoveryKey), String(req.body.recoveryPassphrase || ''));
            }
            const result = yield (0, restoreBackup_1.restoreBackup)(prisma, req.file.buffer, ownerId(res), res.locals.userId ? ownerId(res) : null, undefined, recoveryKey, (0, ocrPremium_1.ocrOwnerKey)(res));
            res.json(Object.assign({ success: true }, result));
        }
        catch (error) {
            console.error('[backup] restore:', error);
            res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się przywrócić kopii zapasowej.' });
        }
    }));
    router.post('/import-external', upload.single('archive'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!req.file)
            return res.status(400).json({ error: 'Wybierz plik archiwum ZIP do zaimportowania.' });
        try {
            const result = yield (0, externalImport_1.importExternalArchive)(prisma, req.file.buffer, ownerId(res), res.locals.userId ? ownerId(res) : null, undefined, (0, ocrPremium_1.ocrOwnerKey)(res));
            res.json(Object.assign({ success: true }, result));
        }
        catch (error) {
            console.error('[backup] import-external:', error);
            res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się zaimportować archiwum.' });
        }
    }));
    return router;
}
/** Public OAuth callback. Ownership is recovered from the short-lived state token. */
function createBackupOAuthCallbackRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/callback', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const state = String(req.query.state || '');
        const context = oauthStates.get(state);
        oauthStates.delete(state);
        if (!context || context.expiresAt < Date.now())
            return res.status(400).send('Sesja OAuth wygasła. Wróć do E‑Teczki i spróbuj ponownie.');
        const config = cloudBackupTransfer_1.oauthConfig[context.provider];
        const code = String(req.query.code || '');
        if (!config || !code)
            return res.status(400).send('Brak kodu autoryzacji OAuth.');
        try {
            const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: (0, cloudBackupTransfer_1.oauthCallbackUrl)(), client_id: config.clientId, client_secret: config.clientSecret });
            const tokenResponse = yield fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
            const tokens = yield tokenResponse.json();
            if (!tokenResponse.ok || !tokens.access_token)
                return res.status(502).send('Dostawca chmury odrzucił autoryzację.');
            yield prisma.backupDestination.upsert({ where: { ownerKey: context.ownerKey }, create: { ownerKey: context.ownerKey, provider: context.provider, encryptedCredentials: (0, backupCrypto_1.encrypt)(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true }, update: { provider: context.provider, encryptedCredentials: (0, backupCrypto_1.encrypt)(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true } });
            res.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka</title><h2>Chmura została połączona.</h2><p>Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p>');
        }
        catch (_a) {
            res.status(502).send('Nie udało się zapisać połączenia chmury.');
        }
    }));
    return router;
}
