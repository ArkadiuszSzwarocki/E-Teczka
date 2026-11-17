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
exports.centralCatalogAdminEnabled = centralCatalogAdminEnabled;
exports.readCentralCatalog = readCentralCatalog;
exports.writeCentralCatalog = writeCentralCatalog;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const planCatalog_1 = require("./planCatalog");
const centralAccountLink_1 = require("./centralAccountLink");
function settings() { if (!(0, planCatalog_1.catalogEnabled)())
    return null; const origin = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL); if (!origin)
    return null; let key = process.env.CENTRAL_CATALOG_ADMIN_TOKEN; try {
    if (!key)
        key = require('node:util').parseEnv(node_fs_1.default.readFileSync(node_path_1.default.resolve(__dirname, '../../central-accounts/.env'), 'utf8')).CENTRAL_CATALOG_ADMIN_TOKEN;
}
catch ( /* Installed applications do not have this developer-only file. */_a) { /* Installed applications do not have this developer-only file. */ } return key ? { origin, key } : null; }
function centralCatalogAdminEnabled() { return Boolean(settings()); }
function readCentralCatalog() {
    return __awaiter(this, void 0, void 0, function* () { const config = settings(); if (!config)
        throw new Error('Centralny panel planów nie jest skonfigurowany.'); const response = yield fetch(`${config.origin}/catalog`, { redirect: 'error', signal: AbortSignal.timeout(7000) }); if (!response.ok)
        throw new Error('Zaktualizuj kontener QNAP, aby odczytać centralne plany.'); const data = yield response.json(); return (0, planCatalog_1.applyCentralCatalog)(data); });
}
function writeCentralCatalog(value) {
    return __awaiter(this, void 0, void 0, function* () { const config = settings(); if (!config)
        throw new Error('Centralny panel planów nie jest skonfigurowany.'); const data = (0, planCatalog_1.validateCatalog)(value); const response = yield fetch(`${config.origin}/admin/catalog`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` }, body: JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(10000) }); if (!response.ok)
        throw new Error('Nie udało się zapisać planów na QNAP-ie. Sprawdź aktualizację kontenera i konfigurację administratora.'); return (0, planCatalog_1.applyCentralCatalog)(yield response.json()); });
}
