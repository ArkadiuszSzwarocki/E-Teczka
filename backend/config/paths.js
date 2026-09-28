"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairedDevicesFile = exports.securityDir = exports.scanDraftsDir = exports.uploadsDir = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Centralna konfiguracja katalogów danych lokalnej E‑Teczki. */
exports.uploadsDir = path_1.default.join(process.cwd(), 'uploads');
exports.scanDraftsDir = path_1.default.join(exports.uploadsDir, '.scan-drafts');
exports.securityDir = path_1.default.join(process.cwd(), 'security');
exports.pairedDevicesFile = path_1.default.join(exports.securityDir, 'paired-devices.json');
for (const directory of [exports.uploadsDir, exports.scanDraftsDir, exports.securityDir]) {
    if (!fs_1.default.existsSync(directory))
        fs_1.default.mkdirSync(directory, { recursive: true });
}
