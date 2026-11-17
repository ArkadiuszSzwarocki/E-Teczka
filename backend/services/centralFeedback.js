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
exports.submitCentralFeedback = submitCentralFeedback;
exports.listCentralFeedback = listCentralFeedback;
exports.updateCentralFeedbackStatus = updateCentralFeedbackStatus;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const centralAccountLink_1 = require("./centralAccountLink");
function adminSettings() {
    const origin = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
    if (!origin)
        return null;
    let key = process.env.CENTRAL_CATALOG_ADMIN_TOKEN;
    try {
        if (!key) {
            const envFile = node_path_1.default.resolve(__dirname, '../../central-accounts/.env');
            key = require('node:util').parseEnv(node_fs_1.default.readFileSync(envFile, 'utf8')).CENTRAL_CATALOG_ADMIN_TOKEN;
        }
    }
    catch (_a) {
        /* Installed applications do not have this developer-only file. */
    }
    return key ? { origin, key } : null;
}
/** Sends a user bug/feedback report with optional screenshot to the central QNAP API. */
function submitCentralFeedback(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const origin = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
        if (!origin)
            throw new Error('Adres serwera QNAP nie jest skonfigurowany.');
        const response = yield fetch(`${origin}/feedback`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
        });
        const body = yield response.json().catch(() => ({}));
        if (!response.ok || typeof body.id !== 'number') {
            throw new Error(body.error || 'Nie udało się wysłać zgłoszenia do serwera QNAP.');
        }
        return { id: body.id, status: body.status || 'new', createdAt: Number(body.createdAt || Date.now()) };
    });
}
/** Lists feedback reports stored in MariaDB on QNAP (developer-only). */
function listCentralFeedback(status) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = adminSettings();
        if (!config)
            throw new Error('Brak konfiguracji administratora QNAP.');
        const query = status ? `?status=${encodeURIComponent(status)}` : '';
        const response = yield fetch(`${config.origin}/admin/feedback${query}`, {
            headers: { authorization: `Bearer ${config.key}` },
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
        });
        const body = yield response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(body.error || 'Nie udało się pobrać zgłoszeń z QNAP-a.');
        return Array.isArray(body.items) ? body.items : [];
    });
}
/** Updates a feedback report status in MariaDB on QNAP (developer-only). */
function updateCentralFeedbackStatus(id, status) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = adminSettings();
        if (!config)
            throw new Error('Brak konfiguracji administratora QNAP.');
        const response = yield fetch(`${config.origin}/admin/feedback/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
            body: JSON.stringify({ status }),
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
        });
        const body = yield response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(body.error || 'Nie udało się zmienić statusu zgłoszenia.');
        return { id: Number(body.id || id), status: body.status || status };
    });
}
