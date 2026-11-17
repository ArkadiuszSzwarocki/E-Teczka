"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAppVersionRouter = createAppVersionRouter;
const express_1 = __importDefault(require("express"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const processStartedAt = new Date().toISOString();
function readCurrentBuildInfo() {
    const pkgPath = node_path_1.default.resolve(__dirname, '../package.json');
    const distIndexPath = node_path_1.default.resolve(__dirname, '../../frontend/dist/index.html');
    let pkgVersion = '1.0.0';
    try {
        const pkg = JSON.parse(node_fs_1.default.readFileSync(pkgPath, 'utf8'));
        if (pkg.version)
            pkgVersion = pkg.version;
    }
    catch ( /* keep fallback */_a) { /* keep fallback */ }
    let builtAt = processStartedAt;
    let buildStamp = processStartedAt;
    try {
        if (node_fs_1.default.existsSync(distIndexPath)) {
            const stat = node_fs_1.default.statSync(distIndexPath);
            builtAt = stat.mtime.toISOString();
            buildStamp = String(Math.round(stat.mtimeMs));
        }
    }
    catch ( /* keep process start timestamp */_b) { /* keep process start timestamp */ }
    return {
        version: `${pkgVersion}-${buildStamp}`,
        builtAt,
    };
}
/** Exposes the active server & frontend build version so clients can prompt users before updating. */
function createAppVersionRouter() {
    const router = express_1.default.Router();
    router.get('/', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.json(readCurrentBuildInfo());
    });
    return router;
}
