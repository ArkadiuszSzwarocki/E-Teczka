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
exports.verifyBackupPrimary = verifyBackupPrimary;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function matches(password, salt, expectedHex) {
    if (!password || password.length > 200 || !/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(expectedHex))
        return false;
    const actual = node_crypto_1.default.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return node_crypto_1.default.timingSafeEqual(actual, expected);
}
function verifyBackupPrimary(prisma, owner, password) {
    return __awaiter(this, void 0, void 0, function* () {
        if (owner.startsWith('user:')) {
            const id = Number(owner.slice(5));
            if (!Number.isSafeInteger(id) || id <= 0)
                return false;
            const user = yield prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
            const [salt, hash] = ((user === null || user === void 0 ? void 0 : user.passwordHash) || '').split(':');
            return matches(password, salt || '', hash || '');
        }
        if (owner !== 'desktop-local' || !process.env.APPDATA)
            return false;
        try {
            const lock = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(process.env.APPDATA, 'eteczka-master', 'access-lock.json'), 'utf8'));
            return matches(password, lock.salt || '', lock.hash || '');
        }
        catch (_a) {
            return false;
        }
    });
}
