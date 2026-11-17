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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_DURATION_MS = void 0;
exports.activeSessionWhere = activeSessionWhere;
exports.effectiveSessionExpiry = effectiveSessionExpiry;
exports.ensureIdleSessionPolicy = ensureIdleSessionPolicy;
exports.SESSION_DURATION_MS = 20 * 60 * 1000;
function activeSessionWhere(now = new Date()) { return { expiresAt: { gt: now } }; }
function effectiveSessionExpiry(_createdAt, expiresAt) { return expiresAt; }
const upgrades = new WeakMap();
/** Cap historical fixed/long sessions once; later activity extensions survive restarts. */
function ensureIdleSessionPolicy(prisma) {
    const db = prisma;
    if (typeof db.$executeRawUnsafe !== 'function' || typeof db.$transaction !== 'function')
        return Promise.resolve();
    let pending = upgrades.get(prisma);
    if (!pending) {
        pending = db.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            yield tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SessionPolicyMigration (name TEXT PRIMARY KEY)');
            const inserted = yield tx.$executeRawUnsafe("INSERT OR IGNORE INTO SessionPolicyMigration(name) VALUES ('idle-v1')");
            if (inserted)
                yield tx.$executeRawUnsafe(`UPDATE AuthSession SET expiresAt=MIN(expiresAt, CASE WHEN typeof(createdAt) IN ('integer','real') THEN createdAt+${exports.SESSION_DURATION_MS} ELSE CAST(strftime('%s',createdAt) AS INTEGER)*1000+${exports.SESSION_DURATION_MS} END)`);
        })).then(() => undefined);
        upgrades.set(prisma, pending);
    }
    return pending;
}
