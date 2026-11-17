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
exports.oauthCallbackUrl = exports.oauthConfig = void 0;
exports.backupFilename = backupFilename;
exports.backupFiles = backupFiles;
exports.requireBackupFiles = requireBackupFiles;
exports.buildBackupArchive = buildBackupArchive;
exports.buildEncryptedBackupBuffer = buildEncryptedBackupBuffer;
exports.refreshOAuthCredentials = refreshOAuthCredentials;
exports.uploadEncryptedBackupToCloud = uploadEncryptedBackupToCloud;
exports.listCloudBackups = listCloudBackups;
exports.downloadCloudBackup = downloadCloudBackup;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_stream_1 = require("node:stream");
const archiver = __importStar(require("archiver"));
const paths_1 = require("../config/paths");
const planLedger_1 = require("./planLedger");
const backupCrypto_1 = require("./backupCrypto");
const webdavFolders_1 = require("./webdavFolders");
exports.oauthConfig = {
    'google-drive': { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive.file', clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    dropbox: { authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', scope: 'files.content.write files.content.read', clientId: process.env.DROPBOX_CLIENT_ID, clientSecret: process.env.DROPBOX_CLIENT_SECRET },
    onedrive: { authorize: 'https://login.microsoftonline.com/common/v2.0/authorize', token: 'https://login.microsoftonline.com/common/v2.0/token', scope: 'Files.ReadWrite.AppFolder offline_access', clientId: process.env.ONEDRIVE_CLIENT_ID, clientSecret: process.env.ONEDRIVE_CLIENT_SECRET },
};
const oauthCallbackUrl = () => process.env.ETECZKA_OAUTH_CALLBACK_URL || 'http://localhost:3000/api/backup/oauth/callback';
exports.oauthCallbackUrl = oauthCallbackUrl;
function backupFilename(now = new Date()) {
    return `eteczka-${now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.zip.enc`;
}
function backupFiles(documents) {
    return documents.map(document => ({ source: node_path_1.default.join(paths_1.uploadsDir, document.filePath), archiveName: `files/${document.id}-${node_path_1.default.basename(document.filePath)}` }));
}
function requireBackupFiles(files) {
    const missing = files.find(file => !node_fs_1.default.existsSync(file.source));
    if (missing)
        throw new Error('Brak pliku dokumentu na dysku. Kopia nie została utworzona.');
}
function buildBackupArchive(prisma, ownerIdValue, planKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const folders = yield prisma.folder.findMany({ where: { ownerId: ownerIdValue }, orderBy: { id: 'asc' } });
        const documents = yield prisma.document.findMany({ where: { folder: { ownerId: ownerIdValue } }, include: { tags: { include: { tag: true } } }, orderBy: { id: 'asc' } });
        const files = backupFiles(documents);
        requireBackupFiles(files);
        const manifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            planState: yield (0, planLedger_1.exportPlanState)(prisma, planKey),
            folders,
            documents: documents.map((_a) => {
                var { tags } = _a, document = __rest(_a, ["tags"]);
                return (Object.assign(Object.assign({}, document), { tags: tags.map(({ tag }) => tag) }));
            }),
        };
        return { manifest, files };
    });
}
function buildEncryptedBackupBuffer(prisma, ownerIdValue, planKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const { manifest, files } = yield buildBackupArchive(prisma, ownerIdValue, planKey);
        const pass = new node_stream_1.PassThrough();
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
        return (0, backupCrypto_1.encryptBackup)(Buffer.concat(chunks));
    });
}
function refreshOAuthCredentials(prisma, destination) {
    return __awaiter(this, void 0, void 0, function* () {
        const credentials = destination.encryptedCredentials ? JSON.parse((0, backupCrypto_1.decrypt)(destination.encryptedCredentials)) : {};
        if (!credentials.refreshToken || !credentials.expiresAt || credentials.expiresAt > Date.now() + 60000)
            return credentials;
        const config = exports.oauthConfig[destination.provider];
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
function uploadEncryptedBackupToCloud(destination_1, credentials_1, data_1) {
    return __awaiter(this, arguments, void 0, function* (destination, credentials, data, filename = backupFilename()) {
        const folder = destination.remoteFolder ? destination.remoteFolder.replace(/^\/+|\/+$/g, '') : '';
        const payloadBody = new Uint8Array(data);
        if (destination.provider === 'webdav') {
            const target = (0, webdavFolders_1.webDavFileUrl)(destination.endpoint, destination.remoteFolder || '', filename);
            return fetch(target, { method: 'PUT', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}`, 'Content-Type': 'application/zip' }, body: payloadBody });
        }
        if (destination.provider === 'dropbox') {
            return fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${folder ? `${folder}/` : ''}${filename}`, mode: 'add', autorename: true }), 'Content-Type': 'application/octet-stream' }, body: payloadBody });
        }
        if (destination.provider === 'onedrive') {
            return fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${folder ? `${folder}/` : ''}${filename}:/content`, { method: 'PUT', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/zip' }, body: payloadBody });
        }
        const metadata = JSON.stringify(Object.assign({ name: filename, mimeType: 'application/zip' }, (destination.remoteFolder ? { parents: [destination.remoteFolder] } : {})));
        const multipart = `----EtecZkaBoundary${Date.now()}`;
        const body = Buffer.concat([Buffer.from(`--${multipart}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${multipart}\r\nContent-Type: application/zip\r\n\r\n`), data, Buffer.from(`\r\n--${multipart}--`)]);
        return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': `multipart/related; boundary=${multipart}` }, body: new Uint8Array(body) });
    });
}
function listCloudBackups(destination, credentials) {
    return __awaiter(this, void 0, void 0, function* () {
        const folder = destination.remoteFolder ? `/${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}` : '';
        if (destination.provider === 'dropbox') {
            const response = yield fetch('https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: folder, recursive: false }) });
            const payload = yield response.json();
            if (!response.ok)
                throw new Error('Dropbox list failed');
            return { ok: true, backups: (payload.entries || []).filter(e => { var _a; return (_a = e.name) === null || _a === void 0 ? void 0 : _a.endsWith('.zip.enc'); }).sort((a, b) => String(b.server_modified).localeCompare(String(a.server_modified))).map(e => ({ name: e.name, modifiedAt: e.server_modified || null })) };
        }
        if (destination.provider === 'onedrive') {
            const response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:${folder}:/children`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
            const payload = yield response.json();
            if (!response.ok)
                throw new Error('OneDrive list failed');
            return { ok: true, backups: (payload.value || []).filter(e => { var _a; return (_a = e.name) === null || _a === void 0 ? void 0 : _a.endsWith('.zip.enc'); }).sort((a, b) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime))).map(e => ({ name: e.name, modifiedAt: e.lastModifiedDateTime || null })) };
        }
        if (destination.provider === 'google-drive') {
            const q = `name contains '.zip.enc' and trashed = false${destination.remoteFolder ? ` and '${destination.remoteFolder}' in parents` : ''}`;
            const response = yield fetch(`https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime%20desc&pageSize=50&fields=files(name,modifiedTime)&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
            const payload = yield response.json();
            if (!response.ok)
                throw new Error('Google Drive list failed');
            return { ok: true, backups: (payload.files || []).filter(e => e.name).map(e => ({ name: e.name, modifiedAt: e.modifiedTime || null })) };
        }
        const base = (0, webdavFolders_1.webDavFolderUrl)(destination.endpoint, destination.remoteFolder || '');
        const response = yield fetch(base, { method: 'PROPFIND', redirect: 'error', headers: { Depth: '1', 'Content-Type': 'application/xml', Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getlastmodified/></prop></propfind>' });
        if (!response.ok)
            return { ok: false, status: 502, error: `NAS nie udostępnił listy kopii (HTTP ${response.status}). Sprawdź dane logowania i dostęp do folderu.` };
        return { ok: true, backups: (0, webdavFolders_1.listWebDavBackups)(yield response.text(), base) };
    });
}
function downloadCloudBackup(destination, credentials, requestedFilename) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        let filename = requestedFilename;
        if (!filename) {
            if (destination.provider === 'webdav') {
                const base = (0, webdavFolders_1.webDavFolderUrl)(destination.endpoint, destination.remoteFolder || '');
                const listRes = yield fetch(base, { method: 'PROPFIND', redirect: 'error', headers: { Depth: '1', 'Content-Type': 'application/xml', Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` }, body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getlastmodified/></prop></propfind>' });
                if (!listRes.ok)
                    return { ok: false, status: 502, error: `NAS nie udostępnił listy kopii (HTTP ${listRes.status}). Sprawdź dane logowania i dostęp do folderu.` };
                filename = (0, webdavFolders_1.findLatestWebDavBackup)(yield listRes.text(), base) || '';
            }
            else {
                const listed = yield listCloudBackups(destination, credentials);
                if (!listed.ok)
                    return listed;
                filename = ((_a = listed.backups[0]) === null || _a === void 0 ? void 0 : _a.name) || '';
            }
        }
        if (!filename)
            return { ok: false, status: 404, error: 'Nie znaleziono zaszyfrowanej kopii.' };
        const folder = destination.remoteFolder ? `${destination.remoteFolder.replace(/^\/+|\/+$/g, '')}/` : '';
        let response;
        if (destination.provider === 'dropbox') {
            response = yield fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${folder}${filename}` }) } });
        }
        else if (destination.provider === 'onedrive') {
            response = yield fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${folder}${filename}:/content`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
        }
        else if (destination.provider === 'google-drive') {
            const search = yield fetch(`https://www.googleapis.com/drive/v3/files?fields=files(id)&pageSize=1&q=${encodeURIComponent(`name = '${filename.replace(/'/g, "\\'")}' and trashed = false`)}`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
            const found = yield search.json();
            if (!search.ok || !((_c = (_b = found.files) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.id))
                throw new Error('Google Drive file not found');
            response = yield fetch(`https://www.googleapis.com/drive/v3/files/${found.files[0].id}?alt=media`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
        }
        else {
            response = yield fetch((0, webdavFolders_1.webDavFileUrl)(destination.endpoint, destination.remoteFolder || '', filename), { redirect: 'error', headers: { Authorization: `Basic ${Buffer.from(`${credentials.username || ''}:${credentials.password || ''}`).toString('base64')}` } });
        }
        if (!response.ok)
            return { ok: false, status: 502, error: `Nie udało się pobrać kopii (HTTP ${response.status}).` };
        return { ok: true, buffer: Buffer.from(yield response.arrayBuffer()) };
    });
}
