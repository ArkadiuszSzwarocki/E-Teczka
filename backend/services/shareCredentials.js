"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.newShareToken = newShareToken;
exports.hashShareToken = hashShareToken;
exports.newSharePin = newSharePin;
exports.hashSharePin = hashSharePin;
exports.verifySharePin = verifySharePin;
const node_crypto_1 = require("node:crypto");
/** Link and PIN are separate secrets; never store a raw public token or PIN. */
function newShareToken() { return (0, node_crypto_1.randomBytes)(32).toString('base64url'); }
function hashShareToken(token) { return (0, node_crypto_1.createHash)('sha256').update(token, 'utf8').digest('hex'); }
function newSharePin() { return String((0, node_crypto_1.randomInt)(0, 1000000)).padStart(6, '0'); }
function hashSharePin(pin) {
    if (!/^\d{6}$/.test(pin))
        throw new Error('PIN musi mieć sześć cyfr.');
    const salt = (0, node_crypto_1.randomBytes)(16);
    return `${salt.toString('hex')}:${(0, node_crypto_1.scryptSync)(pin, salt, 32).toString('hex')}`;
}
function verifySharePin(pin, encoded) {
    if (!/^\d{6}$/.test(pin) || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(encoded))
        return false;
    const [salt, digest] = encoded.split(':');
    const expected = Buffer.from(digest, 'hex');
    return (0, node_crypto_1.timingSafeEqual)(expected, (0, node_crypto_1.scryptSync)(pin, Buffer.from(salt, 'hex'), expected.length));
}
