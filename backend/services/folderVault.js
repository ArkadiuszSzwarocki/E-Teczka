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
exports.createFolderVaultStore = createFolderVaultStore;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const backupCrypto_1 = require("./backupCrypto");
const backupAuthenticator_1 = require("./backupAuthenticator");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function hashSecret(secret, salt) {
    return node_crypto_1.default.scryptSync(secret, salt, 64).toString('hex');
}
function sameHash(actual, expected) {
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length > 0 && a.length === b.length && node_crypto_1.default.timingSafeEqual(a, b);
}
function validateVaultSecrets(password, pin) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
        throw new Error('Nowe hasło do sejfu musi mieć od 8 do 200 znaków.');
    }
    if (typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) {
        throw new Error('Nowy kod PIN do sejfu musi składać się z 6–12 cyfr.');
    }
    if (password === pin) {
        throw new Error('Hasło i PIN do sejfu nie mogą być identyczne.');
    }
}
/** Encrypted per-folder vault store requiring Password + PIN + Authenticator + Biometrics. */
function createFolderVaultStore(filename, now = Date.now) {
    const pendingSetups = new Map();
    const pendingRecoveries = new Map();
    const pepper = node_crypto_1.default.randomBytes(32);
    function load() {
        try {
            const raw = node_fs_1.default.readFileSync(filename, 'utf8');
            const parsed = JSON.parse((0, backupCrypto_1.decrypt)(raw));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return {};
            throw e;
        }
    }
    function save(data) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(filename), { recursive: true });
        const temp = `${filename}.${node_crypto_1.default.randomBytes(8).toString('hex')}.tmp`;
        try {
            node_fs_1.default.writeFileSync(temp, (0, backupCrypto_1.encrypt)(JSON.stringify(data)), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            node_fs_1.default.renameSync(temp, filename);
        }
        finally {
            try {
                node_fs_1.default.unlinkSync(temp);
            }
            catch ( /* already renamed */_a) { /* already renamed */ }
        }
    }
    function status(key) {
        const rec = load()[key];
        if (!rec)
            return { configured: false, loginMethod: null, biometricEnabled: false, recoveryEmailConfigured: false };
        return {
            configured: true,
            loginMethod: rec.loginMethod,
            biometricEnabled: rec.biometricEnabled,
            recoveryEmailConfigured: Boolean(rec.recoveryEmail),
        };
    }
    function startSetup(key) {
        const generated = (0, backupAuthenticator_1.createBackupAuthenticator)(`Sejf-${key}`);
        pendingSetups.set(key, { secret: generated.secret, expiresAt: now() + 10 * 60000 });
        return { uri: generated.uri, secret: generated.secret };
    }
    function confirmSetup(key, input) {
        const proposal = pendingSetups.get(key);
        if (!proposal || proposal.expiresAt <= now()) {
            pendingSetups.delete(key);
            throw new Error('Sesja konfiguracji sejfu wygasła. Zeskanuj kod QR ponownie.');
        }
        validateVaultSecrets(input.password, input.pin);
        if (!['pin_totp', 'password_totp', 'biometric_totp'].includes(input.loginMethod)) {
            throw new Error('Wybierz sposób logowania do sejfu.');
        }
        if (input.loginMethod === 'biometric_totp' && !input.biometricEnabled) {
            throw new Error('Zweryfikuj biometrię, aby wybrać logowanie biometrią.');
        }
        if (!EMAIL_RE.test(input.recoveryEmail.trim())) {
            throw new Error('Podaj prawidłowy adres e-mail do odzyskiwania.');
        }
        const step = (0, backupAuthenticator_1.verifyBackupAuthenticator)(proposal.secret, input.totpCode.replace(/\s/g, ''));
        if (step === null) {
            throw new Error('Nieprawidłowy kod z Microsoft Authenticator.');
        }
        const passwordSalt = node_crypto_1.default.randomBytes(16).toString('hex');
        const pinSalt = node_crypto_1.default.randomBytes(16).toString('hex');
        const data = load();
        data[key] = {
            passwordSalt,
            passwordHash: hashSecret(input.password, passwordSalt),
            pinSalt,
            pinHash: hashSecret(input.pin, pinSalt),
            totpSecret: proposal.secret,
            lastStep: step,
            biometricEnabled: input.biometricEnabled,
            loginMethod: input.loginMethod,
            recoveryEmail: input.recoveryEmail.trim(),
            failures: 0,
            blockedUntil: 0,
        };
        save(data);
        pendingSetups.delete(key);
        return status(key);
    }
    function verifyTotpForRecord(data, key, rec, totpCode) {
        if (rec.blockedUntil > now())
            return false;
        const step = (0, backupAuthenticator_1.verifyBackupAuthenticator)(rec.totpSecret, totpCode.replace(/\s/g, ''));
        if (step === null || step <= rec.lastStep) {
            rec.failures += 1;
            if (rec.failures >= 5) {
                rec.blockedUntil = now() + 5 * 60000;
                rec.failures = 0;
            }
            data[key] = rec;
            save(data);
            return false;
        }
        rec.lastStep = step;
        rec.failures = 0;
        rec.blockedUntil = 0;
        data[key] = rec;
        save(data);
        return true;
    }
    function unlock(key, input) {
        const data = load();
        const rec = data[key];
        if (!rec)
            throw new Error('Sejf nie został jeszcze skonfigurowany.');
        if (rec.blockedUntil > now())
            throw new Error('Zbyt wiele prób. Odczekaj 5 minut.');
        if (!verifyTotpForRecord(data, key, rec, input.totpCode || '')) {
            throw new Error('Nieprawidłowy lub zużyty kod Authenticatora.');
        }
        if (rec.loginMethod === 'pin_totp') {
            if (!input.secret || !sameHash(hashSecret(input.secret, rec.pinSalt), rec.pinHash)) {
                throw new Error('Nieprawidłowy kod PIN do sejfu.');
            }
        }
        else if (rec.loginMethod === 'password_totp') {
            if (!input.secret || !sameHash(hashSecret(input.secret, rec.passwordSalt), rec.passwordHash)) {
                throw new Error('Nieprawidłowe hasło do sejfu.');
            }
        }
        else if (rec.loginMethod === 'biometric_totp') {
            if (!input.biometricVerified) {
                throw new Error('Wymagana weryfikacja biometryczna (Windows Hello).');
            }
        }
        return { ok: true };
    }
    function requestRecovery(key, totpCode, sendMail) {
        return __awaiter(this, void 0, void 0, function* () {
            const data = load();
            const rec = data[key];
            if (!rec)
                throw new Error('Sejf nie został skonfigurowany.');
            if (!verifyTotpForRecord(data, key, rec, totpCode)) {
                throw new Error('Podaj aktualny kod z Microsoft Authenticator, aby wysłać kod na e-mail.');
            }
            const code = node_crypto_1.default.randomInt(10000000, 100000000).toString();
            yield sendMail(rec.recoveryEmail, code);
            const codeHash = node_crypto_1.default.createHmac('sha256', pepper).update(code).digest('hex');
            pendingRecoveries.set(key, { codeHash, expiresAt: now() + 10 * 60000, attempts: 0 });
            return { sentTo: rec.recoveryEmail.replace(/(^.).*(@.*$)/, '$1***$2') };
        });
    }
    function completeRecovery(key, input) {
        const pending = pendingRecoveries.get(key);
        if (!pending || pending.expiresAt <= now()) {
            pendingRecoveries.delete(key);
            throw new Error('Kod e-mail wygasł. Wyślij nowy kod po podaniu Authenticatora.');
        }
        const actualHash = node_crypto_1.default.createHmac('sha256', pepper).update(input.emailCode.trim()).digest('hex');
        if (!sameHash(actualHash, pending.codeHash)) {
            pending.attempts += 1;
            if (pending.attempts >= 5)
                pendingRecoveries.delete(key);
            throw new Error('Nieprawidłowy kod z wiadomości e-mail.');
        }
        const data = load();
        const rec = data[key];
        if (!rec)
            throw new Error('Sejf nie istnieje.');
        validateVaultSecrets(input.newPassword, input.newPin);
        const passwordSalt = node_crypto_1.default.randomBytes(16).toString('hex');
        const pinSalt = node_crypto_1.default.randomBytes(16).toString('hex');
        rec.passwordSalt = passwordSalt;
        rec.passwordHash = hashSecret(input.newPassword, passwordSalt);
        rec.pinSalt = pinSalt;
        rec.pinHash = hashSecret(input.newPin, pinSalt);
        rec.failures = 0;
        rec.blockedUntil = 0;
        data[key] = rec;
        save(data);
        pendingRecoveries.delete(key);
        return { ok: true };
    }
    return { status, startSetup, confirmSetup, unlock, requestRecovery, completeRecovery };
}
