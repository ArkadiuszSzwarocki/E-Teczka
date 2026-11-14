"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.encryptBackup = encryptBackup;
exports.exportRecoveryKey = exportRecoveryKey;
exports.importRecoveryKey = importRecoveryKey;
exports.decryptBackup = decryptBackup;
const crypto_1 = __importDefault(require("crypto"));
const authSecret_1 = require("../security/authSecret");
const key = crypto_1.default.createHash('sha256').update((0, authSecret_1.authSecret)()).digest();
const header = Buffer.from('ETECZKA-BACKUP-1\n');
function encrypt(value) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decrypt(value, decryptionKey = key) {
    const [iv, tag, data] = value.split('.');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', decryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
function encryptBackup(data) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([header, iv, cipher.getAuthTag(), encrypted]);
}
function exportRecoveryKey(passphrase) {
    if (passphrase.length < 12)
        throw new Error('Hasło klucza odzyskiwania musi mieć co najmniej 12 znaków.');
    const salt = crypto_1.default.randomBytes(16);
    const iv = crypto_1.default.randomBytes(12);
    const wrappingKey = crypto_1.default.scryptSync(passphrase, salt, 32);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', wrappingKey, iv);
    const encrypted = Buffer.concat([cipher.update(key), cipher.final()]);
    return JSON.stringify({ type: 'eteczka-backup-recovery', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), key: encrypted.toString('base64') });
}
function importRecoveryKey(contents, passphrase) {
    try {
        if (contents.length > 4096 || passphrase.length > 1024)
            throw new Error();
        const value = JSON.parse(contents);
        if (value.type !== 'eteczka-backup-recovery' || value.version !== 1 || !value.salt || !value.iv || !value.tag || !value.key)
            throw new Error();
        const salt = Buffer.from(value.salt, 'base64');
        const iv = Buffer.from(value.iv, 'base64');
        const tag = Buffer.from(value.tag, 'base64');
        const encrypted = Buffer.from(value.key, 'base64');
        if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || encrypted.length !== 32)
            throw new Error();
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', crypto_1.default.scryptSync(passphrase, salt, 32), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }
    catch (_a) {
        throw new Error('Nieprawidłowy plik klucza odzyskiwania lub hasło.');
    }
}
function decryptBackup(data, recoveryKey = key) {
    if (!data.subarray(0, header.length).equals(header))
        return data;
    const ivStart = header.length;
    const tagStart = ivStart + 12;
    const payloadStart = tagStart + 16;
    if (data.length <= payloadStart)
        throw new Error('Uszkodzona zaszyfrowana kopia.');
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', recoveryKey, data.subarray(ivStart, tagStart));
    decipher.setAuthTag(data.subarray(tagStart, payloadStart));
    return Buffer.concat([decipher.update(data.subarray(payloadStart)), decipher.final()]);
}
