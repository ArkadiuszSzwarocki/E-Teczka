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
exports.createBackupMfaRouter = createBackupMfaRouter;
exports.requireBackupMfa = requireBackupMfa;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = __importDefault(require("express"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
const accessControl_1 = require("../middleware/accessControl");
const premium_1 = require("../middleware/premium");
const backupMfaStore_1 = require("../services/backupMfaStore");
const backupPrimary_1 = require("../services/backupPrimary");
const mfa = (0, backupMfaStore_1.createBackupMfaStore)(node_path_1.default.join(paths_1.securityDir, 'backup-mfa.enc'));
const grants = new Map();
const attempts = new Map();
const mfaOwner = (res) => `documents:${Number(res.locals.userId || 1)}`;
const actions = { send: ['destination', 'cloud'], cloudRestore: ['cloud/latest', 'restore'], restore: ['restore'], export: ['export'], recoveryKey: ['recovery-key'], connect: ['oauth'] };
function createBackupMfaRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/status', (_req, res) => { try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ enabled: mfa.enabled(mfaOwner(res)) });
    }
    catch (_a) {
        res.status(503).json({ error: 'Nie można odczytać zabezpieczeń kopii.' });
    } });
    router.post('/start', accessControl_1.requireLocalDesktop, (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const owner = mfaOwner(res);
        const primaryOwner = (0, premium_1.billingOwnerKey)(res);
        const now = Date.now();
        const previous = attempts.get(owner);
        if (previous && previous.expires > now && previous.count >= 5)
            return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj za 5 minut.' });
        if (!(yield (0, backupPrimary_1.verifyBackupPrimary)(prisma, primaryOwner, String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.password) || '')))) {
            const entry = previous && previous.expires > now ? previous : { count: 0, expires: now + 300000 };
            entry.count++;
            attempts.set(owner, entry);
            return res.status(401).json({ error: 'Nieprawidłowy PIN lub hasło E-Teczki.' });
        }
        attempts.delete(owner);
        try {
            const { uri } = mfa.start(owner);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ uri });
        }
        catch (error) {
            res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się rozpocząć konfiguracji.' });
        }
    }));
    router.post('/confirm', accessControl_1.requireLocalDesktop, (req, res) => { var _a; try {
        const codes = mfa.confirm(mfaOwner(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.code) || ''));
        res.setHeader('Cache-Control', 'no-store');
        res.json({ codes });
    }
    catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Nie udało się włączyć Authenticatora.' });
    } });
    router.post('/disable', accessControl_1.requireLocalDesktop, (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const owner = mfaOwner(res);
        const now = Date.now();
        const previous = attempts.get(owner);
        if (previous && previous.expires > now && previous.count >= 5)
            return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj za 5 minut.' });
        if (!(yield (0, backupPrimary_1.verifyBackupPrimary)(prisma, (0, premium_1.billingOwnerKey)(res), String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.password) || '')))) {
            const entry = previous && previous.expires > now ? previous : { count: 0, expires: now + 300000 };
            entry.count++;
            attempts.set(owner, entry);
            return res.status(401).json({ error: 'Nieprawidłowy PIN lub hasło E-Teczki.' });
        }
        attempts.delete(owner);
        try {
            if (!mfa.verify(owner, String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.code) || '')))
                return res.status(401).json({ error: 'Nieprawidłowy lub użyty kod Authenticatora.' });
            mfa.remove(owner);
            for (const [token, grant] of grants)
                if (grant.owner === owner)
                    grants.delete(token);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ enabled: false });
        }
        catch (_c) {
            return res.status(503).json({ error: 'Nie można zmienić zabezpieczeń kopii.' });
        }
    }));
    router.post('/authorize', accessControl_1.requireLocalDesktop, (req, res) => {
        var _a, _b;
        const owner = mfaOwner(res);
        const action = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.action) || '');
        if (!actions[action])
            return res.status(400).json({ error: 'Nieznana operacja.' });
        try {
            if (!mfa.enabled(owner))
                return res.json({ required: false });
            if (!mfa.verify(owner, String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.code) || '')))
                return res.status(401).json({ error: 'Nieprawidłowy lub użyty kod. Po wielu błędach odczekaj 5 minut.' });
            const token = node_crypto_1.default.randomBytes(32).toString('base64url');
            for (const [key, value] of grants)
                if (value.expires <= Date.now())
                    grants.delete(key);
            grants.set(token, { owner, expires: Date.now() + 15 * 60000, remaining: new Set(actions[action]) });
            res.setHeader('Cache-Control', 'no-store');
            res.json({ required: true, token });
        }
        catch (_c) {
            res.status(503).json({ error: 'Nie można odczytać zabezpieczeń kopii.' });
        }
    });
    return router;
}
function requireBackupMfa(operation) {
    return (req, res, next) => {
        const owner = mfaOwner(res);
        try {
            if (!mfa.enabled(owner))
                return next();
            const token = req.header('x-backup-authorization') || '';
            const grant = grants.get(token);
            if (!grant || grant.owner !== owner || grant.expires <= Date.now() || !grant.remaining.has(operation))
                return res.status(403).json({ code: 'BACKUP_MFA_REQUIRED', error: 'Potwierdź tę operację kodem Microsoft Authenticator.' });
            grant.remaining.delete(operation);
            if (!grant.remaining.size)
                grants.delete(token);
            return next();
        }
        catch (_a) {
            return res.status(503).json({ error: 'Nie można odczytać zabezpieczeń kopii.' });
        }
    };
}
