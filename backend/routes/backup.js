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
const adm_zip_1 = __importDefault(require("adm-zip"));
const multer_1 = __importDefault(require("multer"));
const paths_1 = require("../config/paths");
const authSecret_1 = require("../security/authSecret");
const premium_1 = require("../middleware/premium");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });
const ownerId = (res) => Number(res.locals.userId || 1);
const BACKUP_SECRET = crypto_1.default.createHash('sha256').update((0, authSecret_1.authSecret)()).digest();
const allowedProviders = new Set(['webdav', 'google-drive', 'onedrive', 'dropbox']);
const oauthStates = new Map();
const oauthConfig = {
    'google-drive': { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    dropbox: { authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', scope: 'files.content.write files.content.read', clientId: process.env.DROPBOX_CLIENT_ID, clientSecret: process.env.DROPBOX_CLIENT_SECRET },
    onedrive: { authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: 'Files.ReadWrite.AppFolder offline_access', clientId: process.env.ONEDRIVE_CLIENT_ID, clientSecret: process.env.ONEDRIVE_CLIENT_SECRET },
};
const oauthCallbackUrl = () => process.env.ETECZKA_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/backup/oauth/callback';
function encrypt(value) { const iv = crypto_1.default.randomBytes(12); const cipher = crypto_1.default.createCipheriv('aes-256-gcm', BACKUP_SECRET, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`; }
function decrypt(value) { const [ivRaw, tagRaw, dataRaw] = value.split('.'); const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', BACKUP_SECRET, Buffer.from(ivRaw, 'base64url')); decipher.setAuthTag(Buffer.from(tagRaw, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8'); }
function encryptBackup(data) { const iv = crypto_1.default.randomBytes(12); const cipher = crypto_1.default.createCipheriv('aes-256-gcm', BACKUP_SECRET, iv); const encrypted = Buffer.concat([cipher.update(data), cipher.final()]); return Buffer.concat([Buffer.from('ETECZKA-BACKUP-1\n'), iv, cipher.getAuthTag(), encrypted]); }
function decryptBackup(data) {
    const header = Buffer.from('ETECZKA-BACKUP-1\n');
    if (!data.subarray(0, header.length).equals(header))
        return data;
    const ivStart = header.length;
    const tagStart = ivStart + 12;
    const payloadStart = tagStart + 16;
    if (data.length <= payloadStart)
        throw new Error('Uszkodzona zaszyfrowana kopia.');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', BACKUP_SECRET, data.subarray(ivStart, tagStart));
    decipher.setAuthTag(data.subarray(tagStart, payloadStart));
    return Buffer.concat([decipher.update(data.subarray(payloadStart)), decipher.final()]);
}
function refreshOAuthCredentials(prisma, destination) {
    return __awaiter(this, void 0, void 0, function* () {
        const credentials = destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) : {};
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
        yield prisma.backupDestination.update({ where: { id: destination.id }, data: { encryptedCredentials: encrypt(JSON.stringify(updated)) } });
        return updated;
    });
}
function isPremium(prisma, res) {
    return __awaiter(this, void 0, void 0, function* () { return (0, premium_1.hasPremium)(prisma, res); });
}
/** Executes a scheduled backup for an owner. ownerId is the document owner id. */
function runScheduledCloudBackup(prisma, ownerKey, ownerIdValue) {
    return __awaiter(this, void 0, void 0, function* () {
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled) || !destination.schedule || destination.schedule === 'manual')
            return false;
        const folders = yield prisma.folder.findMany({ where: { ownerId: ownerIdValue }, orderBy: { id: 'asc' } });
        const documents = yield prisma.document.findMany({ where: { folder: { ownerId: ownerIdValue } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
        const manifest = { version: 1, exportedAt: new Date().toISOString(), folders, documents: documents.map((_a) => {
                var { tags } = _a, document = __rest(_a, ["tags"]);
                return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
            }) };
        const pass = new stream_1.PassThrough();
        const chunks = [];
        pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.pipe(pass);
        archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
        for (const document of documents) {
            const source = path_1.default.join(paths_1.uploadsDir, document.filePath);
            if (fs_1.default.existsSync(source))
                archive.file(source, { name: `files/${document.id}-${path_1.default.basename(document.filePath)}` });
        }
        const complete = new Promise((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
        yield archive.finalize();
        yield complete;
        const credentials = destination.provider === 'webdav' ? (destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) : {}) : yield refreshOAuthCredentials(prisma, destination);
        const data = encryptBackup(Buffer.concat(chunks));
        const filename = `eteczka-${new Date().toISOString().slice(0, 10)}.zip.enc`;
        let response;
        if (destination.provider === 'webdav') {
            const target = `${destination.endpoint.replace(/\/$/, '')}/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`;
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
    router.get('/oauth/:provider/start', (req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Integracje chmurowe wymagają Premium.' });
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
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Backup do chmury wymaga planu Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        res.json(destination ? { provider: destination.provider, endpoint: destination.endpoint, remoteFolder: destination.remoteFolder, schedule: destination.schedule, enabled: destination.enabled, configured: true } : { configured: false });
    }));
    router.put('/destination', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Backup do chmury wymaga planu Premium.' });
        const provider = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.provider) || '');
        const endpoint = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.endpoint) === 'string' ? req.body.endpoint.trim().slice(0, 2000) : '';
        const remoteFolder = typeof ((_c = req.body) === null || _c === void 0 ? void 0 : _c.remoteFolder) === 'string' ? req.body.remoteFolder.trim().slice(0, 500) : '';
        const schedule = ['manual', 'daily', 'weekly'].includes(String((_d = req.body) === null || _d === void 0 ? void 0 : _d.schedule)) ? String(req.body.schedule) : 'manual';
        const username = typeof ((_e = req.body) === null || _e === void 0 ? void 0 : _e.username) === 'string' ? req.body.username : '';
        const password = typeof ((_f = req.body) === null || _f === void 0 ? void 0 : _f.password) === 'string' ? req.body.password : '';
        if (!allowedProviders.has(provider))
            return res.status(400).json({ error: 'Nieobsługiwany dostawca chmury.' });
        if (provider === 'webdav' && (!endpoint || !/^https:\/\//i.test(endpoint)))
            return res.status(400).json({ error: 'QNAP/WebDAV wymaga adresu HTTPS.' });
        const existing = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        const credentials = provider === 'webdav' ? encrypt(JSON.stringify({ username, password })) : (existing === null || existing === void 0 ? void 0 : existing.encryptedCredentials) || null;
        const destination = yield prisma.backupDestination.upsert({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) }, create: { ownerKey: (0, premium_1.billingOwnerKey)(res), provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule, encryptedCredentials: credentials }, update: Object.assign(Object.assign({ provider, endpoint: endpoint || null, remoteFolder: remoteFolder || null, schedule }, (credentials ? { encryptedCredentials: credentials } : {})), { enabled: true }) });
        res.json({ provider: destination.provider, endpoint: destination.endpoint, remoteFolder: destination.remoteFolder, schedule: destination.schedule, enabled: destination.enabled, configured: true });
    }));
    router.post('/cloud', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Automatyczny backup do chmury wymaga planu Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        try {
            const folders = yield prisma.folder.findMany({ where: { ownerId: ownerId(res) }, orderBy: { id: 'asc' } });
            const documents = yield prisma.document.findMany({ where: { folder: { ownerId: ownerId(res) } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
            const manifest = { version: 1, exportedAt: new Date().toISOString(), folders, documents: documents.map((_a) => {
                    var { tags } = _a, document = __rest(_a, ["tags"]);
                    return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
                }) };
            const pass = new stream_1.PassThrough();
            const chunks = [];
            pass.on('data', chunk => chunks.push(Buffer.from(chunk)));
            const archive = archiver('zip', { zlib: { level: 6 } });
            archive.pipe(pass);
            archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
            for (const document of documents) {
                const source = path_1.default.join(paths_1.uploadsDir, document.filePath);
                if (fs_1.default.existsSync(source))
                    archive.file(source, { name: `files/${document.id}-${path_1.default.basename(document.filePath)}` });
            }
            const complete = new Promise((resolve, reject) => { pass.on('end', () => resolve()); pass.on('error', reject); });
            yield archive.finalize();
            yield complete;
            const credentials = destination.provider === 'webdav' ? (destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) : {}) : yield refreshOAuthCredentials(prisma, destination);
            const data = encryptBackup(Buffer.concat(chunks));
            const filename = `eteczka-${new Date().toISOString().slice(0, 10)}.zip.enc`;
            let response;
            if (destination.provider === 'webdav') {
                const target = `${destination.endpoint.replace(/\/$/, '')}/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`;
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
                return res.status(502).json({ error: `QNAP/WebDAV odrzucił kopię (HTTP ${response.status}).` });
            res.json({ success: true, provider: destination.provider, uploadedAt: new Date().toISOString() });
        }
        catch (_a) {
            res.status(502).json({ error: 'Nie udało się wysłać kopii do chmury.' });
        }
    }));
    router.get('/cloud/latest', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        if (!(yield isPremium(prisma, res)))
            return res.status(402).json({ code: 'PREMIUM_REQUIRED', error: 'Backup do chmury wymaga planu Premium.' });
        const destination = yield prisma.backupDestination.findUnique({ where: { ownerKey: (0, premium_1.billingOwnerKey)(res) } });
        if (!(destination === null || destination === void 0 ? void 0 : destination.enabled))
            return res.status(400).json({ error: 'Najpierw skonfiguruj miejsce kopii zapasowej.' });
        try {
            const credentials = destination.provider === 'webdav' ? (destination.encryptedCredentials ? JSON.parse(decrypt(destination.encryptedCredentials)) : {}) : yield refreshOAuthCredentials(prisma, destination);
            let filename = '';
            if (destination.provider === 'dropbox') {
                const response = yield fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: destination.remoteFolder ? `/${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}` : '', recursive: false }) });
                const payload = yield response.json();
                if (!response.ok)
                    throw new Error('Dropbox list failed');
                filename = ((_a = (payload.entries || []).filter(entry => { var _a; return (_a = entry.name) === null || _a === void 0 ? void 0 : _a.endsWith('.zip.enc'); }).sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified)))[0]) === null || _a === void 0 ? void 0 : _a.name) || '';
            }
            else if (destination.provider === 'onedrive') {
                const folder = destination.remoteFolder ? `/${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}` : '';
                const response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:${folder}:/children`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
                const payload = yield response.json();
                if (!response.ok)
                    throw new Error('OneDrive list failed');
                filename = ((_b = (payload.value || []).filter(entry => { var _a; return (_a = entry.name) === null || _a === void 0 ? void 0 : _a.endsWith('.zip.enc'); }).sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)))[0]) === null || _b === void 0 ? void 0 : _b.name) || '';
            }
            else if (destination.provider === 'google-drive') {
                const q = `name contains '.zip.enc' and trashed = false${destination.remoteFolder ? ` and '${destination.remoteFolder}' in parents` : ''}`;
                const response = yield fetch(`https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime%20desc&pageSize=1&fields=files(name)&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
                const payload = yield response.json();
                if (!response.ok)
                    throw new Error('Google Drive list failed');
                filename = ((_d = (_c = payload.files) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.name) || '';
            }
            else {
                const base = `${destination.endpoint.replace(/\/$/, '')}/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}`;
                const response = yield fetch(base, { method: 'PROPFIND', headers: { Depth: '1', Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` } });
                const text = yield response.text();
                if (!response.ok)
                    throw new Error('WebDAV list failed');
                filename = [...text.matchAll(/(?:href|displayname)>?[^<]*([^<]*\.zip\.enc)/gi)].map(match => match[1]).sort().pop() || '';
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
                if (!search.ok || !((_f = (_e = found.files) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.id))
                    throw new Error('Google Drive file not found');
                response = yield fetch(`https://www.googleapis.com/drive/v3/files/${found.files[0].id}?alt=media`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
            }
            else
                response = yield fetch(`${destination.endpoint.replace(/\/$/, '')}/${destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : ''}${filename}`, { headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` } });
            if (!response.ok)
                return res.status(502).json({ error: `Nie udało się pobrać kopii (HTTP ${response.status}).` });
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(Buffer.from(yield response.arrayBuffer()));
        }
        catch (error) {
            console.error('[backup] cloud download:', error);
            res.status(502).json({ error: 'Nie udało się pobrać kopii z chmury.' });
        }
    }));
    router.get('/export', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const currentOwner = ownerId(res);
        const folders = yield prisma.folder.findMany({ where: { ownerId: currentOwner }, orderBy: { id: 'asc' } });
        const documents = yield prisma.document.findMany({ where: { folder: { ownerId: currentOwner } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
        const manifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            folders,
            documents: documents.map((_a) => {
                var { tags } = _a, document = __rest(_a, ["tags"]);
                return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
            }),
        };
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip"`);
        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (error) => { if (!res.headersSent)
            res.status(500); res.end(); console.error('[backup] export:', error); });
        archive.pipe(res);
        archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
        for (const document of documents) {
            const source = path_1.default.join(paths_1.uploadsDir, document.filePath);
            if (fs_1.default.existsSync(source))
                archive.file(source, { name: `files/${document.id}-${path_1.default.basename(document.filePath)}` });
        }
        yield archive.finalize();
    }));
    router.post('/restore', upload.single('backup'), (req, res) => __awaiter(this, void 0, void 0, function* () {
        if (!req.file)
            return res.status(400).json({ error: 'Wybierz plik kopii zapasowej.' });
        try {
            const zip = new adm_zip_1.default(decryptBackup(req.file.buffer));
            const manifestEntry = zip.getEntry('manifest.json');
            if (!manifestEntry)
                return res.status(400).json({ error: 'Nieprawidłowa kopia: brak manifestu.' });
            const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
            if (manifest.version !== 1 || !Array.isArray(manifest.folders) || !Array.isArray(manifest.documents))
                return res.status(400).json({ error: 'Nieobsługiwana wersja kopii zapasowej.' });
            const currentOwner = ownerId(res);
            const folderMap = new Map();
            yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
                const pending = [...manifest.folders];
                while (pending.length) {
                    const index = pending.findIndex(folder => !folder.parentId || folderMap.has(Number(folder.parentId)));
                    if (index < 0)
                        throw new Error('Nieprawidłowa hierarchia kartotek.');
                    const source = pending.splice(index, 1)[0];
                    const created = yield tx.folder.create({ data: { name: String(source.name || 'Przywrócona kartoteka').slice(0, 255), parentId: source.parentId ? folderMap.get(Number(source.parentId)) || null : null, ownerId: currentOwner, order: Number(source.order) || 0 } });
                    folderMap.set(Number(source.id), created.id);
                }
                for (const source of manifest.documents) {
                    const folderId = folderMap.get(Number(source.folderId));
                    if (!folderId)
                        continue;
                    const entryName = `files/${source.id}-${path_1.default.basename(String(source.filePath || ''))}`;
                    const entry = zip.getEntry(entryName);
                    if (!entry)
                        continue;
                    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${path_1.default.basename(String(source.filePath))}`;
                    fs_1.default.writeFileSync(path_1.default.join(paths_1.uploadsDir, safeName), entry.getData());
                    const created = yield tx.document.create({ data: { title: String(source.title || 'Przywrócony dokument').slice(0, 255), filePath: safeName, mimeType: String(source.mimeType || 'application/octet-stream'), folderId, userId: res.locals.userId ? currentOwner : null, retentionEnabled: source.retentionEnabled !== false, retentionValue: Number(source.retentionValue) || 5, retentionUnit: String(source.retentionUnit || 'years'), isArchived: Boolean(source.isArchived), isDeleted: false, ocrText: typeof source.ocrText === 'string' ? source.ocrText.slice(0, 100000) : null } });
                    for (const tag of source.tags || []) {
                        const tagRecord = yield tx.tag.upsert({ where: { name: String(tag.name || '').slice(0, 80) }, create: { name: String(tag.name || 'tag').slice(0, 80), color: String(tag.color || '#2563eb') }, update: {} });
                        yield tx.documentTag.create({ data: { documentId: created.id, tagId: tagRecord.id } }).catch(() => undefined);
                    }
                }
            }));
            res.json({ success: true, restoredFolders: manifest.folders.length, restoredDocuments: manifest.documents.length });
        }
        catch (error) {
            console.error('[backup] restore:', error);
            res.status(400).json({ error: 'Nie udało się przywrócić kopii zapasowej.' });
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
            yield prisma.backupDestination.upsert({ where: { ownerKey: context.ownerKey }, create: { ownerKey: context.ownerKey, provider: context.provider, encryptedCredentials: encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true }, update: { provider: context.provider, encryptedCredentials: encrypt(JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 })), enabled: true } });
            res.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka</title><h2>Chmura została połączona.</h2><p>Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p>');
        }
        catch (_a) {
            res.status(502).send('Nie udało się zapisać połączenia z chmurą.');
        }
    }));
    return router;
}
