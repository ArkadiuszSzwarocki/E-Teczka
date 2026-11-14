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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWebDavEndpoint = normalizeWebDavEndpoint;
exports.webDavFileUrl = webDavFileUrl;
exports.webDavFolderUrl = webDavFolderUrl;
exports.listWebDavFolders = listWebDavFolders;
exports.createWebDavFolder = createWebDavFolder;
exports.findLatestWebDavBackup = findLatestWebDavBackup;
const fast_xml_parser_1 = require("fast-xml-parser");
const parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
const array = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
function segments(folder) {
    const parts = folder.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part)))
        throw new Error('Nieprawidłowa ścieżka folderu.');
    return parts;
}
function normalizeWebDavEndpoint(endpoint) {
    let base;
    const value = endpoint.trim();
    try {
        base = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    }
    catch (_a) {
        throw new Error('Podaj adres IP lub nazwę serwera NAS, opcjonalnie z portem i ścieżką WebDAV.');
    }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
        throw new Error('Podaj prawidłowy adres HTTPS usługi WebDAV bez danych logowania.');
    return base.toString().replace(/\/$/, '');
}
function target(connection, folder) {
    const base = new URL(normalizeWebDavEndpoint(connection.endpoint));
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/${segments(folder).map(encodeURIComponent).join('/')}${folder ? '/' : ''}`;
    return base;
}
function webDavFileUrl(endpoint, folder, filename) {
    const directory = target({ endpoint, username: '', password: '' }, folder);
    return new URL(encodeURIComponent(filename), directory.toString().replace(/\/?$/, '/')).toString();
}
function webDavFolderUrl(endpoint, folder) {
    return target({ endpoint, username: '', password: '' }, folder).toString();
}
function request(connection, folder, method) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield fetch(target(connection, folder), Object.assign({ method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: Object.assign({ Authorization: `Basic ${Buffer.from(`${connection.username}:${connection.password}`).toString('base64')}` }, (method === 'PROPFIND' ? { Depth: '1', 'Content-Type': 'application/xml' } : {})) }, (method === 'PROPFIND' ? { body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><displayname/></prop></propfind>' } : {})));
        if (!response.ok)
            throw new Error(`Serwer WebDAV odrzucił żądanie (HTTP ${response.status}). Sprawdź adres, dane logowania i uprawnienia.`);
        return response;
    });
}
function listWebDavFolders(connection, folder) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const current = target(connection, folder);
        const response = yield request(connection, folder, 'PROPFIND');
        const text = yield response.text();
        if (text.length > 2000000)
            throw new Error('Odpowiedź serwera jest zbyt duża.');
        const parsed = parser.parse(text);
        const results = [];
        for (const entry of array((_a = parsed.multistatus) === null || _a === void 0 ? void 0 : _a.response)) {
            if (typeof entry.href !== 'string')
                continue;
            const resource = new URL(entry.href, current);
            if (resource.origin !== current.origin)
                continue;
            const parentPath = current.pathname.replace(/\/+$/, '') + '/';
            if (!resource.pathname.startsWith(parentPath))
                continue;
            const relative = resource.pathname.slice(parentPath.length).replace(/\/+$/, '');
            if (!relative || relative.includes('/'))
                continue;
            const properties = array(entry.propstat);
            if (!properties.some(item => { var _a; return /\s2\d\d\s/.test(item.status || '') && ((_a = item.prop) === null || _a === void 0 ? void 0 : _a.resourcetype) && Object.prototype.hasOwnProperty.call(item.prop.resourcetype, 'collection'); }))
                continue;
            let name;
            try {
                name = decodeURIComponent(relative);
            }
            catch (_b) {
                continue;
            }
            try {
                segments(name);
                if (name.includes('/'))
                    continue;
            }
            catch (_c) {
                continue;
            }
            results.push({ name, path: [...segments(folder), name].join('/') });
        }
        return results.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    });
}
function createWebDavFolder(connection, folder, name) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!name.trim() || name !== name.trim() || name.includes('/') || segments(name).length !== 1)
            throw new Error('Podaj prawidłową nazwę folderu bez ukośników.');
        yield request(connection, [...segments(folder), name].join('/'), 'MKCOL');
    });
}
/** Find a backup in the selected directory without trusting paths returned by the server. */
function findLatestWebDavBackup(xml, folderUrl) {
    var _a, _b;
    if (xml.length > 2000000)
        throw new Error('Lista plików NAS-a jest zbyt duża.');
    const current = new URL(folderUrl);
    const parsed = parser.parse(xml);
    if (parsed.multistatus === '')
        return null;
    if (!parsed.multistatus || typeof parsed.multistatus !== 'object')
        throw new Error('NAS zwrócił nieprawidłową listę WebDAV.');
    const parent = `${current.pathname.replace(/\/+$/, '')}/`;
    const candidates = [];
    for (const entry of array(parsed.multistatus.response)) {
        if (typeof entry.href !== 'string')
            continue;
        let url;
        try {
            url = new URL(entry.href, current);
        }
        catch (_c) {
            continue;
        }
        if (url.origin !== current.origin || !url.pathname.startsWith(parent))
            continue;
        const relative = url.pathname.slice(parent.length);
        if (!relative || relative.includes('/') || url.search || url.hash)
            continue;
        let name;
        try {
            name = decodeURIComponent(relative);
        }
        catch (_d) {
            continue;
        }
        if (!name.toLowerCase().endsWith('.zip.enc') || name.includes('/') || name.includes('\\') || name === '..')
            continue;
        const props = array(entry.propstat);
        const prop = (_a = props.find(item => /\s2\d\d\s/.test(item.status || ''))) === null || _a === void 0 ? void 0 : _a.prop;
        if (!prop)
            continue;
        if (prop.resourcetype && typeof prop.resourcetype === 'object' && Object.prototype.hasOwnProperty.call(prop.resourcetype, 'collection'))
            continue;
        const modified = typeof prop.getlastmodified === 'string' ? Date.parse(prop.getlastmodified) : NaN;
        candidates.push({ name, modified: Number.isFinite(modified) ? modified : 0 });
    }
    candidates.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
    return ((_b = candidates[0]) === null || _b === void 0 ? void 0 : _b.name) || null;
}
