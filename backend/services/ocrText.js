"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectOcrText = protectOcrText;
exports.readOcrText = readOcrText;
const backupCrypto_1 = require("./backupCrypto");
const prefix = 'eteczka-ocr-v1:';
/** New OCR text is encrypted at rest; pre-existing text remains readable for migration. */
function protectOcrText(text) { return prefix + (0, backupCrypto_1.encrypt)(text); }
function readOcrText(value, key) {
    if (!value)
        return '';
    return value.startsWith(prefix) ? (0, backupCrypto_1.decrypt)(value.slice(prefix.length), key) : value;
}
