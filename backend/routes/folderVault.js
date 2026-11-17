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
exports.createFolderVaultRouter = createFolderVaultRouter;
const express_1 = __importDefault(require("express"));
const node_path_1 = __importDefault(require("node:path"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const paths_1 = require("../config/paths");
const folderVault_1 = require("../services/folderVault");
const store = (0, folderVault_1.createFolderVaultStore)(node_path_1.default.join(paths_1.securityDir, 'folder-vaults.enc'));
function sendVaultRecoveryEmail(to, code) {
    return __awaiter(this, void 0, void 0, function* () {
        const host = process.env.ETECZKA_SMTP_HOST;
        const user = process.env.ETECZKA_SMTP_USER;
        const pass = process.env.ETECZKA_SMTP_PASSWORD;
        const from = process.env.ETECZKA_SMTP_FROM;
        if (!host || !user || !pass || !from) {
            throw new Error('Wysyłka e-mail (SMTP) nie jest skonfigurowana w pliku backend/.env.');
        }
        const port = Number(process.env.ETECZKA_SMTP_PORT || 465);
        const transport = nodemailer_1.default.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
        yield transport.sendMail({
            from,
            to,
            subject: 'E-Teczka Sejf — kod odzyskiwania hasła i PIN-u',
            text: `Kod odzyskiwania sejfu E-Teczki: ${code}\n\nKod jest ważny przez 10 minut.`,
        });
    });
}
/** Per-folder Safe Vault endpoints requiring Password, PIN, Authenticator, and Biometrics. */
function createFolderVaultRouter(prisma) {
    const router = express_1.default.Router();
    const ownerId = (res) => Number(res.locals.userId || 1);
    function resolveKey(folderIdRaw, res) {
        return __awaiter(this, void 0, void 0, function* () {
            const folderId = Number(folderIdRaw);
            if (!Number.isInteger(folderId) || folderId < 1)
                return null;
            const owner = ownerId(res);
            const folder = yield prisma.folder.findFirst({ where: { id: folderId, ownerId: owner }, select: { id: true } });
            return folder ? `${owner}:${folder.id}` : null;
        });
    }
    router.get('/:folderId/status', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const key = yield resolveKey(req.params.folderId, res);
        if (!key)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        res.json(store.status(key));
    }));
    router.post('/:folderId/setup/start', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const key = yield resolveKey(req.params.folderId, res);
        if (!key)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        res.setHeader('Cache-Control', 'no-store');
        res.json(store.startSetup(key));
    }));
    router.post('/:folderId/setup/confirm', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const key = yield resolveKey(req.params.folderId, res);
        if (!key)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        try {
            const providedEmail = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.recoveryEmail) || '').trim();
            const user = providedEmail ? null : yield prisma.user.findUnique({ where: { id: ownerId(res) }, select: { email: true } });
            const result = store.confirmSetup(key, {
                password: String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.password) || ''),
                pin: String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.pin) || ''),
                totpCode: String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.totpCode) || ''),
                loginMethod: String(((_e = req.body) === null || _e === void 0 ? void 0 : _e.loginMethod) || ''),
                biometricEnabled: Boolean((_f = req.body) === null || _f === void 0 ? void 0 : _f.biometricEnabled),
                recoveryEmail: providedEmail || (user === null || user === void 0 ? void 0 : user.email) || '',
            });
            res.json(result);
        }
        catch (e) {
            res.status(400).json({ error: e instanceof Error ? e.message : 'Nie udało się zapisać sejfu.' });
        }
    }));
    router.post('/:folderId/unlock', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const key = yield resolveKey(req.params.folderId, res);
        if (!key)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        try {
            res.json(store.unlock(key, {
                secret: typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.secret) === 'string' ? req.body.secret : undefined,
                biometricVerified: Boolean((_b = req.body) === null || _b === void 0 ? void 0 : _b.biometricVerified),
                totpCode: String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.totpCode) || ''),
            }));
        }
        catch (e) {
            res.status(401).json({ error: e instanceof Error ? e.message : 'Nie udało się odblokować sejfu.' });
        }
    }));
    router.post('/:folderId/recovery/request', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const key = yield resolveKey(req.params.folderId, res);
        if (!key)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        try {
            const result = yield store.requestRecovery(key, String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.totpCode) || ''), sendVaultRecoveryEmail);
            res.json(result);
        }
        catch (e) {
            res.status(400).json({ error: e instanceof Error ? e.message : 'Nie udało się wysłać kodu na e-mail.' });
        }
    }));
    router.post('/:folderId/recovery/complete', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const key = yield resolveKey(req.params.folderId, res);
        if (!key)
            return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
        try {
            res.json(store.completeRecovery(key, {
                emailCode: String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.emailCode) || ''),
                totpCode: String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.totpCode) || ''),
                newPassword: String(((_c = req.body) === null || _c === void 0 ? void 0 : _c.newPassword) || ''),
                newPin: String(((_d = req.body) === null || _d === void 0 ? void 0 : _d.newPin) || ''),
            }));
        }
        catch (e) {
            res.status(400).json({ error: e instanceof Error ? e.message : 'Nie udało się zmienić hasła i PIN-u sejfu.' });
        }
    }));
    return router;
}
