"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_DURATION_MS = void 0;
exports.activeSessionWhere = activeSessionWhere;
exports.effectiveSessionExpiry = effectiveSessionExpiry;
exports.SESSION_DURATION_MS = 20 * 60 * 1000;
function activeSessionWhere(now = new Date()) {
    return { expiresAt: { gt: now }, createdAt: { gt: new Date(now.getTime() - exports.SESSION_DURATION_MS) } };
}
function effectiveSessionExpiry(createdAt, expiresAt) {
    return new Date(Math.min(expiresAt.getTime(), createdAt.getTime() + exports.SESSION_DURATION_MS));
}
