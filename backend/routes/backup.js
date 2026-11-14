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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runScheduledCloudBackup = runScheduledCloudBackup;
exports.createBackupRouter = createBackupRouter;
exports.createBackupOAuthCallbackRouter = createBackupOAuthCallbackRouter;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const stream_1 = require("stream");
const archiver = __importStar(require("archiver"));
const multer_1 = __importDefault(require("multer"));
const paths_1 = require("../config/paths");
const premium_1 = require("../middleware/premium");
const planLedger_1 = require("../services/planLedger");
const ocrPremium_1 = require("../services/ocrPremium");
const backupCrypto_1 = require("../services/backupCrypto");
const accessControl_1 = require("../middleware/accessControl");
const restoreBackup_1 = require("../services/restoreBackup");
const webdavFolders_1 = require("../services/webdavFolders");
const webdavCertificate_1 = require("../services/webdavCertificate");
const backupMfa_1 = require("./backupMfa");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res) => Number(res.locals.userId || 1);
const allowedProviders = new Set(['webdav', 'google-drive', 'onedrive', 'dropbox']);
const oauthStates = new Map();
const oauthConfig = {
    'google-drive': { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    dropbox: { authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', scope: 'files.content.write files.content.read', clientId: process.env.DROPBOX_CLIENT_ID, clientSecret: process.env.DROPBOX_CLIENT_SECRET },
    onedrive: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'Files.ReadWrite.AppFolder offline_access', clientId: process.env.ONEDRIVE_CLIENT_ID, clientSecret: process.env.ONEDRIVE_CLIENT_SECRET },
};
const oauthCallbackUrl = () => process.env.ETECZKA_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/backup/oauth/callback';
function backupFiles(documents) {
    return documents.map(document => ({ source: path_1.default.join(paths_1.uploadsDir, document.filePath), archiveName: `files/${document.id}-${path_1.default.basename(document.filePath)}` }));
}
function requireBackupFiles(files) {
    const missing = files.find(file => !fs_1.default.existsSync(file.source));
    if (missing)
        throw new Error('Brak pliku dokumentu na dysku. Kopia nie została utworzona.');
}
function refreshOAuthCredentials(prisma, destination) {
    return __awaiter(this, void 0, void 0, function* () {
        const credentials = destination.encryptedCredentials ? JSON.parse((0, backupCrypto_1.decrypt)(destination.encryptedCredentials)) : {};
        if (!credentials.refreshToken || !credentials.expiresAt || credentials.expiresAt > Date.now() + 60000)
            return credentials;
        const config = oauthConfig[destination.provider];
        if (!(config === null || config === void 0 ? void 0 : config.clientId) || !config.clientSecret)
            return credentials;
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: config.clientId, client_secret: config.clientSecret });
        const response = yield fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const tokens = yield response.json();
        if (!response.ok || !tokens.access_token)
            throw new Error('Nie udało się odświeżyć tokenu OAuth.');
        const updated = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || credentials.refreshToken, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
        yield prisma.backupDestination.update({ where: { id: destination.id }, data: { encryptedCredentials: (0, backupCrypto_1.encrypt)(JSON.stringify(updated)) } });
        return updated;
    });
}
function isPremium(prisma, res) {
    return __awaiter(this, void 0, void 0, function* () { const req = res.req; const start = req.method !== 'GET' || req.path.startsWith('/oauth/'); return (yield (0, planLedger_1.featureTrial)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res), 'cloudBackup', start)).allowed; });
}
/** Executes a scheduled backup for an owner. ownerId is the document owner id. */
function runScheduledCloudBackup(prisma, ownerKey, ownerIdValue) {
    return __awaiter(this, void 0, void 0, function* () {
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled) || !destination.schedule || destination.schedule === 'manual')
            return false;
        const folders = yield prisma.folder.findMany({ where: { ownerId: ownerIdValue }, orderBy: { id: 'asc' } });
        const documents = yield prisma.document.findMany({ where: { folder: { ownerId: ownerIdValue } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
        const files = backupFiles(documents);
        requireBackupFiles(files);
        const manifest = { version: 1, exportedAt: new Date().toISOString(), planState: yield (0, planLedger_1.exportPlanState)(prisma, ownerKey), folders, documents: documents.map((_a) => {
                var { tags } = _a, document = __rest(_a, ["tags"]);
                return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
            }) };
        const pass = new stream_1.PassThrough();
        const chunks = [];
        pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
        const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
        archive.on('error', (error) => pass.destroy(error));
        archive.pipe(pass);
        archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
        for (const file of files)
            archive.file(file.source, { name: file.archiveName });
        const complete = new Promise((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
        yield archive.finalize();
        yield complete;
        const credentials = destination.provider === 'webdav' ? (destination.encryptedCredentials ? JSON.parse((0, backupCrypto_1.decrypt)(destination.encryptedCredentials)) : {}) : yield refreshOAuthCredentials(prisma, destination);
        if (destination.provider === 'webdav' && (credentials.purpose !== 'backup-only' || !credentials.username || !credentials.password))
            throw new Error('Skonfiguruj osobne konto NAS przeznaczone do automatycznej kopii.');
        const data = (0, backupCrypto_1.encryptBackup)(Buffer.concat(chunks));
        const filename = `eteczka-${new Date().toISOString().slice(0, 10)}.zip.enc`;
        let response;
        if (destination.provider === 'webdav') {
            const target = (0, webdavFolders_1.webDavFileUrl)(destination.endpoint, destination.remoteFolder || '', filename);
            response = yield fetch(target, { method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}`, 'Content-Type': 'application/zip' }, body: data });
        }
        else if (destination.provider === 'dropbox') {
            response = yield fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`, mode: 'overwrite', autorename: false }), 'Content-Type': 'application/octet-stream' }, body: data });
        }
        else if (destination.provider === 'onedrive') {
            response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}:/content`, { method: 'PUT', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/zip' }, body: data });
        }
        else {
            const metadata = JSON.stringify(Object.assign({ name: filename, mimeType: 'application/zip' }, (destination.remoteFolder ? { parents: [destination.remoteFolder] } : {})));
            const multipart = `----EtecZkaBoundary${Date.now()}`;
            const body = Buffer.concat([Buffer.from(`--${multipart}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${multipart}\r\nContent-Type: application/zip\r\n\r\n`), data, Buffer.from(`\r\n--${multipart}--`)]);
            response = yield fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart}` }, body });
        }
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
        const config = oauthConfig[provider];
        if (!config || !config.clientId || !config.clientSecret)
            return res.status(503).json({ error: `Brak konfiguracji OAuth dla ${provider}.` });
        const state = crypto_1.default.randomBytes(24).toString('base64url');
        oauthStates.set(state, { ownerKey: (0, premium_1.billingOwnerKey)(res), provider, expiresAt: Date.now() + 10 * 60000 });
        const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: oauthCallbackUrl(), response_type: 'code', state, scope: config.scope });
        if (provider === 'google-drive')
            params.set('access_type', 'offline');
        if (provider === 'dropbox')
            params.set('token_access_type', 'offline');
        res.redirect(`${config.authorize}?${params.toString()}`);
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
        var _a, _b, _c, _d, _e, _f, _g;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
        const provider = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.provider) || '');
        let endpoint = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.endpoint) === 'string' ? req.body.endpoint.trim().slice(0, 2000) : '';
        const remoteFolder = typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.remoteFolder) === 'string' ? req.body.remoteFolder.trim().slice(0, 500) : '';
        const scheduleValue = String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.schedule) || 'manual');
        if (!/^(manual|(?:daily|weekly)(?:@(?:[01]\d|2[0-3]):[0-5]\d)?)$/.test(scheduleValue))
            return res.status(400).json({ error: 'Nieprawidłowy harmonogram kopii.' });
        const schedule = scheduleValue;
        const username = typeof ((_e = req.body) === null || _e === void 0 ? void 0 : _e.username) === 'string' ? req.body.username.trim() : '';
        const backupUsername = typeof ((_f = req.body) === null || _f === void 0 ? void 0 : _f.backupUsername) === 'string' ? req.body.backupUsername.trim() : '';
        const backupPassword = typeof ((_g = req.body) === null || _g === void 0 ? void 0 : _g.backupPassword) === 'string' ? req.body.backupPassword : '';
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
                if (!backupUsername || backupUsername.toLowerCase() === username.toLowerCase())
                    return res.status(400).json({ error: 'Dla automatycznej kopii użyj osobnego konta NAS przeznaczonego wyłącznie do kopii.' });
                if (backupPassword)
                    credentials = (0, backupCrypto_1.encrypt)(JSON.stringify({ username: backupUsername, password: backupPassword, purpose: 'backup-only' }));
                else {
                    if (!existing || existing.provider !== 'webdav' || !existing.encryptedCredentials || !existing.endpoint || (0, webdavFolders_1.normalizeWebDavEndpoint)(existing.endpoint) !== endpoint)
                        return res.status(400).json({ error: 'Podaj hasło osobnego konta kopii.' });
                    const saved = JSON.parse((0, backupCrypto_1.decrypt)(existing.encryptedCredentials));
                    if (saved.purpose !== 'backup-only' || saved.username !== backupUsername || !saved.password)
                        return res.status(400).json({ error: 'Podaj hasło osobnego konta kopii.' });
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
        var _a, _b;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury zakończył się. Wybierz Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        if (destination.provider === 'webdav' && (!((_a = req.body) === null || _a === void 0 ? void 0 : _a.username) || !((_b = req.body) === null || _b === void 0 ? void 0 : _b.password)))
            return res.status(400).json({ error: 'Podaj swoje dane logowania NAS do ręcznej kopii.' });
        try {
            const folders = yield prisma.folder.findMany({ where: { ownerId: ownerId(res) }, orderBy: { id: 'asc' } });
            const documents = yield prisma.document.findMany({ where: { folder: { ownerId: ownerId(res) } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
            const files = backupFiles(documents);
            requireBackupFiles(files);
            const manifest = { version: 1, exportedAt: new Date().toISOString(), planState: yield (0, planLedger_1.exportPlanState)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)), folders, documents: documents.map((_a) => {
                    var { tags } = _a, document = __rest(_a, ["tags"]);
                    return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
                }) };
            const pass = new stream_1.PassThrough();
            const chunks = [];
            pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
            const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
            archive.on('error', (error) => pass.destroy(error));
            archive.pipe(pass);
            archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
            for (const file of files)
                archive.file(file.source, { name: file.archiveName });
            const complete = new Promise((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
            yield archive.finalize();
            yield complete;
            const credentials = destination.provider === 'webdav' ? { username: String(req.body.username), password: String(req.body.password) } : yield refreshOAuthCredentials(prisma, destination);
            const data = (0, backupCrypto_1.encryptBackup)(Buffer.concat(chunks));
            const filename = `eteczka-${new Date().toISOString().slice(0, 10)}.zip.enc`;
            let response;
            if (destination.provider === 'webdav') {
                const target = (0, webdavFolders_1.webDavFileUrl)(destination.endpoint, destination.remoteFolder || '', filename);
                response = yield fetch(target, { method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}`, 'Content-Type': 'application/zip' }, body: data });
            }
            else if (destination.provider === 'dropbox') {
                response = yield fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`, mode: 'overwrite', autorename: false }), 'Content-Type': 'application/octet-stream' }, body: data });
            }
            else if (destination.provider === 'onedrive') {
                response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}:/content`, { method: 'PUT', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/zip' }, body: data });
            }
            else {
                const metadata = JSON.stringify(Object.assign({ name: filename, mimeType: 'application/zip' }, (destination.remoteFolder ? { parents: [destination.remoteFolder] } : {})));
                const multipart = `----EtecZkaBoundary${Date.now()}`;
                const body = Buffer.concat([Buffer.from(`--${multipart}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${multipart}\r\nContent-Type: application/zip\r\n\r\n`), data, Buffer.from(`\r\n--${multipart}--`)]);
                response = yield fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart}` }, body });
            }
            if (!response.ok)
                return res.status(502).json({ error: response.status === 507 ? 'NAS zgłosił brak dostępnego miejsca (HTTP 507). Sprawdź wolne miejsce, limit konta oraz czy wybrano właściwy folder z prawem zapisu.' : `Serwer ${destination.provider === 'webdav' ? 'NAS/WebDAV' : destination.provider} odrzucił kopię (HTTP ${response.status}). Sprawdź folder i uprawnienia do zapisu.` });
            res.json({ success: true, provider: destination.provider, uploadedAt: new Date().toISOString() });
        }
        catch (error) {
            console.error('[backup] cloud upload:', error);
            res.status(502).json({ error: error instanceof Error && error.message.startsWith('Brak pliku dokumentu') ? error.message : 'Nie udało się utworzyć lub wysłać kopii. Sprawdź log serwera.' });
        }
    }));
    router.post('/cloud/latest', (0, backupMfa_1.requireBackupMfa)('cloud/latest'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Okres próbny kopii do chmury jest niedostępny lub zakończył się. Wybierz Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        if (destination.provider === 'webdav' && (!((_a = req.body) === null || _a === void 0 ? void 0 : _a.username) || !((_b = req.body) === null || _b === void 0 ? void 0 : _b.password)))
            return res.status(400).json({ error: 'Podaj swoje dane logowania NAS, aby pobrać kopię.' });
        try {
            const credentials = destination.provider === 'webdav' ? { username: String(req.body.username), password: String(req.body.password) } : yield refreshOAuthCredentials(prisma, destination);
            let filename = '';
            if (destination.provider === 'dropbox') {
                const response = yield fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: destination.remoteFolder ? `/${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}` : '', recursive: false }) });
                const payload = yield response.json();
                if (!response.ok)
                    throw new Error('Dropbox list failed');
                filename = ((_c = (payload.entries || []).filter(entry => { var _a; return (_a = entry.name) === null || _a === void 0 ? void 0 : _a.endsWith('.zip.enc'); }).sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified)))[0]) === null || _c === void 0 ? void 0 : _c.name) || '';
            }
            else if (destination.provider === 'onedrive') {
                const folder = destination.remoteFolder ? `/${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}` : '';
                const response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:${folder}:/children`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
                const payload = yield response.json();
                if (!response.ok)
                    throw new Error('OneDrive list failed');
                filename = ((_d = (payload.value || []).filter(entry => { var _a; return (_a = entry.name) === null || _a === void 0 ? void 0 : _a.endsWith('.zip.enc'); }).sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)))[0]) === null || _d === void 0 ? void 0 : _d.name) || '';
            }
            else if (destination.provider === 'google-drive') {
                const q = `name contains '.zip.enc' and trashed = false${destination.remoteFolder ? ` and '${destination.remoteFolder}' in parents` : ''}`;
                const response = yield fetch(`https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime%20desc&pageSize=1&fields=files(name)&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
                const payload = yield response.json();
                if (!response.ok)
                    throw new Error('Google Drive list failed');
                filename = ((_f = (_e = payload.files) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.name) || '';
            }
            else {
                const base = (0, webdavFolders_1.webDavFolderUrl)(destination.endpoint, destination.remoteFolder || '');
                const response = yield fetch(base, { method: 'PROPFIND', redirect: 'error', headers: { Depth: '1', 'Content-Type': 'application/xml', Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getlastmodified/></prop></propfind>' });
                if (!response.ok)
                    return res.status(502).json({ error: `NAS nie udostępnił listy kopii (HTTP ${response.status}). Sprawdź dane logowania i dostęp do folderu.` });
                filename = (0, webdavFolders_1.findLatestWebDavBackup)(yield response.text(), base) || '';
            }
            if (!filename)
                return res.status(404).json({ error: 'Nie znaleziono zaszyfrowanej kopii.' });
            let response;
            if (destination.provider === 'dropbox')
                response = yield fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}` }) } });
            else if (destination.provider === 'onedrive')
                response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}:/content`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
            else if (destination.provider === 'google-drive') {
                const search = yield fetch(`https://www.googleapis.com/drive/v3/files?fields=files(id)&pageSize=1&q=${encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and trashed = false`)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
                const found = yield search.json();
                if (!search.ok || !((_h = (_g = found.files) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.id))
                    throw new Error('Google Drive file not found');
                response = yield fetch(`https://www.googleapis.com/drive/v3/files/${found.files[0].id}?alt=media`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
            }
            else
                response = yield fetch((0, webdavFolders_1.webDavFileUrl)(destination.endpoint, destination.remoteFolder || '', filename), { redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` } });
            if (!response.ok)
                return res.status(502).json({ error: `Nie udało się pobrać kopii (HTTP ${response.status}).` });
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment; filename="eteczka-cloud-backup.zip.enc"');
            res.send(Buffer.from(yield response.arrayBuffer()));
        }
        catch (error) {
            console.error('[backup] cloud download:', error);
            res.status(502).json({ error: 'Nie udało się pobrać kopii z chmury.' });
        }
    }));
    router.get('/export', (0, backupMfa_1.requireBackupMfa)('export'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        const currentOwner = ownerId(res);
        const folders = yield prisma.folder.findMany({ where: { ownerId: currentOwner }, orderBy: { id: 'asc' } });
        const documents = yield prisma.document.findMany({ where: { folder: { ownerId: currentOwner } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
        const files = backupFiles(documents);
        try {
            requireBackupFiles(files);
        }
        catch (error) {
            return res.status(409).json({ error: error instanceof Error ? error.message : 'Brak pliku dokumentu.' });
        }
        const manifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            planState: yield (0, planLedger_1.exportPlanState)(prisma, (0, ocrPremium_1.ocrOwnerKey)(res)),
            folders,
            documents: documents.map((_a) => {
                var { tags } = _a, document = __rest(_a, ["tags"]);
                return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
            }),
        };
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
        const config = oauthConfig[context.provider];
        const code = String(req.query.code || '');
        if (!config || !code)
            return res.status(400).send('Brak kodu autoryzacji OAuth.');
        try {
            const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oauthCallbackUrl(), client_id: config.clientId, client_secret: config.clientSecret });
            const tokenResponse = yield fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
            const tokens = yield tokenResponse.json();
            if (!tokenResponse.ok || !tokens.access_token)
                return res.status(502).send('Dostawca chmury odrzucił autoryzację.');
            yield prisma.backupDestination.upsert({ where: { ownerKey: context.ownerKey }, create: { ownerKey: context.ownerKey, provider: context.provider, encryptedCredentials: (0, backupCrypto_1.encrypt)(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true }, update: { provider: context.provider, encryptedCredentials: (0, backupCrypto_1.encrypt)(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true } });
            res.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka</title><h2>Chmura została połączona.</h2><p>Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p>');
        }
        catch (_a) {
            res.status(502).send('Nie udało się zapisać połączenia z chmurą.');
        }
    }));
    return router;
}
