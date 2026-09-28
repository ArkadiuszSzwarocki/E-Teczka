"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authSecret = authSecret;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const paths_1 = require("../config/paths");
const path_1 = __importDefault(require("path"));
const secretFile = path_1.default.join(paths_1.securityDir, 'auth-secret');
function authSecret() {
    if (process.env.AUTH_SECRET)
        return process.env.AUTH_SECRET;
    try {
        const existing = fs_1.default.readFileSync(secretFile, 'utf8').trim();
        if (existing.length >= 32)
            return existing;
    }
    catch (_a) { }
    const generated = crypto_1.default.randomBytes(48).toString('base64url');
    fs_1.default.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    return generated;
}
