"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBackupMfaStore = createBackupMfaStore;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const backupCrypto_1 = require("./backupCrypto");
const backupAuthenticator_1 = require("./backupAuthenticator");
function createBackupMfaStore(filename, now = Date.now) {
    const pending = new Map();
    function load() {
        let text;
        try {
            text = node_fs_1.default.readFileSync(filename, 'utf8');
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return {};
            throw e;
        }
        const parsed = JSON.parse((0, backupCrypto_1.decrypt)(text));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('Nie można odczytać zabezpieczeń kopii.');
        return parsed;
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
    function enabled(owner) { return Boolean(load()[owner]); }
    function start(owner) {
        if (enabled(owner))
            throw new Error('Authenticator jest już włączony.');
        const generated = (0, backupAuthenticator_1.createBackupAuthenticator)(owner);
        pending.set(owner, { secret: generated.secret, expires: now() + 5 * 60000, failures: 0 });
        return generated;
    }
    function confirm(owner, code) {
        const proposal = pending.get(owner);
        if (!proposal || proposal.expires < now()) {
            pending.delete(owner);
            throw new Error('Konfiguracja wygasła.');
        }
        const step = (0, backupAuthenticator_1.verifyBackupAuthenticator)(proposal.secret, code);
        if (step === null) {
            proposal.failures++;
            if (proposal.failures >= 5)
                pending.delete(owner);
            throw new Error('Nieprawidłowy kod Authenticatora.');
        }
        const data = load();
        if (data[owner])
            throw new Error('Authenticator jest już włączony.');
        const recovery = (0, backupAuthenticator_1.createBackupRecoveryCodes)();
        data[owner] = { secret: proposal.secret, hashes: recovery.hashes, lastStep: step, failures: 0, blockedUntil: 0 };
        save(data);
        pending.delete(owner);
        return recovery.codes;
    }
    function verify(owner, code) {
        const data = load();
        const record = data[owner];
        if (!record)
            return false;
        if (record.blockedUntil > now())
            return false;
        const step = (0, backupAuthenticator_1.verifyBackupAuthenticator)(record.secret, code, record.lastStep);
        const index = step === null ? (0, backupAuthenticator_1.matchBackupRecoveryCode)(code, record.hashes) : -1;
        if (step === null && index < 0) {
            record.failures++;
            if (record.failures >= 5) {
                record.blockedUntil = now() + 5 * 60000;
                record.failures = 0;
            }
            save(data);
            return false;
        }
        if (step !== null)
            record.lastStep = step;
        else
            record.hashes.splice(index, 1);
        record.failures = 0;
        record.blockedUntil = 0;
        save(data);
        return true;
    }
    function remove(owner) { const data = load(); if (!data[owner])
        throw new Error('Authenticator nie jest włączony.'); delete data[owner]; save(data); pending.delete(owner); }
    return { enabled, start, confirm, verify, remove };
}
