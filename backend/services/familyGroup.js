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
exports.FamilyError = void 0;
exports.getFamilyOverview = getFamilyOverview;
exports.createFamilyInvite = createFamilyInvite;
exports.acceptFamilyInvite = acceptFamilyInvite;
exports.removeFamilyMember = removeFamilyMember;
exports.cancelFamilyInvite = cancelFamilyInvite;
const node_crypto_1 = __importDefault(require("node:crypto"));
const familyAccess_1 = require("./familyAccess");
const planCatalog_1 = require("./planCatalog");
const planLedger_1 = require("./planLedger");
class FamilyError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.FamilyError = FamilyError;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Returns the current user's family group, active members, sent invites, and incoming invites. */
function getFamilyOverview(prisma, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        yield (0, familyAccess_1.ensureFamilySchema)(prisma);
        const currentUser = yield prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
        const nowIso = new Date().toISOString();
        const membership = yield prisma.$queryRaw `
    SELECT groupId, role FROM FamilyMember WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `;
        let group = null;
        if (membership[0]) {
            const groupId = Number(membership[0].groupId);
            const groupRows = yield prisma.$queryRaw `
      SELECT id, hostUserId FROM FamilyGroup WHERE id = ${groupId} LIMIT 1
    `;
            if (groupRows[0]) {
                const memberRows = yield prisma.$queryRaw `
        SELECT userId, role, joinedAt FROM FamilyMember WHERE groupId = ${groupId} AND status = 'active' ORDER BY id ASC
      `;
                const users = yield prisma.user.findMany({
                    where: { id: { in: memberRows.map(m => Number(m.userId)) } },
                    select: { id: true, email: true, name: true },
                });
                const userMap = new Map(users.map(u => [u.id, u]));
                const role = Number(groupRows[0].hostUserId) === userId ? 'host' : 'member';
                const pendingInvites = role === 'host'
                    ? yield prisma.$queryRaw `
            SELECT id, email, code, expiresAt FROM FamilyInvite
            WHERE groupId = ${groupId} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
            ORDER BY id DESC
          `
                    : [];
                const maxMembers = (_b = (_a = (0, planCatalog_1.getCatalog)().plans.family) === null || _a === void 0 ? void 0 : _a.mobileDevices) !== null && _b !== void 0 ? _b : 4;
                group = {
                    id: groupId,
                    hostUserId: Number(groupRows[0].hostUserId),
                    role,
                    maxMembers,
                    members: memberRows.map(m => {
                        var _a, _b;
                        const u = userMap.get(Number(m.userId));
                        return {
                            userId: Number(m.userId),
                            email: (_a = u === null || u === void 0 ? void 0 : u.email) !== null && _a !== void 0 ? _a : `uzytkownik-${m.userId}`,
                            name: (_b = u === null || u === void 0 ? void 0 : u.name) !== null && _b !== void 0 ? _b : null,
                            role: m.role === 'host' ? 'host' : 'member',
                            joinedAt: m.joinedAt,
                        };
                    }),
                    pendingInvites,
                };
            }
        }
        const normalizedEmail = (_c = currentUser === null || currentUser === void 0 ? void 0 : currentUser.email.trim().toLowerCase()) !== null && _c !== void 0 ? _c : '';
        const incomingInvites = normalizedEmail
            ? yield prisma.$queryRaw `
        SELECT fi.id, u.email AS hostEmail, u.name AS hostName, fi.code, fi.expiresAt
        FROM FamilyInvite fi
        JOIN FamilyGroup fg ON fg.id = fi.groupId
        JOIN User u ON u.id = fg.hostUserId
        WHERE LOWER(fi.email) = ${normalizedEmail}
          AND fi.acceptedAt IS NULL
          AND fi.expiresAt > ${nowIso}
        ORDER BY fi.id DESC
      `
            : [];
        return { group, incomingInvites };
    });
}
/** Creates a 7-day invitation for a family member (requires host to be on Family plan). */
function createFamilyInvite(prisma, hostUserId, emailRaw) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        yield (0, familyAccess_1.ensureFamilySchema)(prisma);
        const email = emailRaw.trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) {
            throw new FamilyError(400, 'Podaj poprawny adres e-mail osoby do zaproszenia.');
        }
        const hostPlan = yield (0, planLedger_1.getPlan)(prisma, `user:${hostUserId}`);
        if (hostPlan !== 'family' && hostPlan !== 'business') {
            throw new FamilyError(403, 'Zapraszanie domowników wymaga aktywnego planu Rodzinny.');
        }
        const host = yield prisma.user.findUnique({ where: { id: hostUserId }, select: { id: true, email: true } });
        if (!host)
            throw new FamilyError(404, 'Nie znaleziono konta gospodarza.');
        if (host.email.trim().toLowerCase() === email) {
            throw new FamilyError(400, 'Nie możesz zaprosić samego siebie.');
        }
        const existingMembership = yield prisma.$queryRaw `
    SELECT groupId, role FROM FamilyMember WHERE userId = ${hostUserId} AND status = 'active' LIMIT 1
  `;
        let groupId = ((_a = existingMembership[0]) === null || _a === void 0 ? void 0 : _a.groupId) ? Number(existingMembership[0].groupId) : 0;
        if (groupId && ((_b = existingMembership[0]) === null || _b === void 0 ? void 0 : _b.role) !== 'host') {
            throw new FamilyError(403, 'Tylko gospodarz grupy rodzinnej może wysyłać zaproszenia.');
        }
        const nowIso = new Date().toISOString();
        if (!groupId) {
            yield prisma.$executeRaw `
      INSERT OR IGNORE INTO FamilyGroup(hostUserId, createdAt) VALUES (${hostUserId}, ${nowIso})
    `;
            const createdGroup = yield prisma.$queryRaw `
      SELECT id FROM FamilyGroup WHERE hostUserId = ${hostUserId} LIMIT 1
    `;
            groupId = Number(createdGroup[0].id);
            yield prisma.$executeRaw `
      INSERT OR IGNORE INTO FamilyMember(groupId, userId, role, status, joinedAt)
      VALUES (${groupId}, ${hostUserId}, 'host', 'active', ${nowIso})
    `;
        }
        const targetUser = yield prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (targetUser) {
            const targetMembership = yield prisma.$queryRaw `
      SELECT groupId FROM FamilyMember WHERE userId = ${targetUser.id} AND status = 'active' LIMIT 1
    `;
            if (targetMembership[0]) {
                throw new FamilyError(409, 'Ta osoba należy już do grupy rodzinnej.');
            }
        }
        const maxMembers = (_d = (_c = (0, planCatalog_1.getCatalog)().plans.family) === null || _c === void 0 ? void 0 : _c.mobileDevices) !== null && _d !== void 0 ? _d : 4;
        const activeCountRows = yield prisma.$queryRaw `
    SELECT COUNT(*) AS cnt FROM FamilyMember WHERE groupId = ${groupId} AND status = 'active'
  `;
        const pendingRows = yield prisma.$queryRaw `
    SELECT COUNT(*) AS cnt FROM FamilyInvite WHERE groupId = ${groupId} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
  `;
        if (Number((_f = (_e = activeCountRows[0]) === null || _e === void 0 ? void 0 : _e.cnt) !== null && _f !== void 0 ? _f : 0) + Number((_h = (_g = pendingRows[0]) === null || _g === void 0 ? void 0 : _g.cnt) !== null && _h !== void 0 ? _h : 0) >= maxMembers) {
            throw new FamilyError(409, `Osiągnięto limit miejsc w grupie rodzinnej (${maxMembers}).`);
        }
        const duplicateRows = yield prisma.$queryRaw `
    SELECT id FROM FamilyInvite
    WHERE groupId = ${groupId} AND LOWER(email) = ${email} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
    LIMIT 1
  `;
        if (duplicateRows[0]) {
            throw new FamilyError(409, 'Aktywne zaproszenie dla tego adresu e-mail już istnieje.');
        }
        const code = node_crypto_1.default.randomBytes(5).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        yield prisma.$executeRaw `
    INSERT INTO FamilyInvite(groupId, email, code, createdByUserId, expiresAt, createdAt)
    VALUES (${groupId}, ${email}, ${code}, ${hostUserId}, ${expiresAt}, ${nowIso})
  `;
        const inserted = yield prisma.$queryRaw `
    SELECT id, email, code, expiresAt FROM FamilyInvite WHERE code = ${code} LIMIT 1
  `;
        return inserted[0];
    });
}
/** Accepts a pending family invitation by invite code (and matches invited email if code not specified). */
function acceptFamilyInvite(prisma, userId, codeRaw) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, familyAccess_1.ensureFamilySchema)(prisma);
        const user = yield prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
        if (!user)
            throw new FamilyError(404, 'Nie znaleziono konta użytkownika.');
        const already = yield prisma.$queryRaw `
    SELECT id FROM FamilyMember WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `;
        if (already[0])
            throw new FamilyError(409, 'Należysz już do grupy rodzinnej.');
        const code = codeRaw.trim().toUpperCase();
        const nowIso = new Date().toISOString();
        const email = user.email.trim().toLowerCase();
        const invites = code
            ? yield prisma.$queryRaw `
        SELECT id, groupId, email FROM FamilyInvite
        WHERE code = ${code} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
        LIMIT 1
      `
            : yield prisma.$queryRaw `
        SELECT id, groupId, email FROM FamilyInvite
        WHERE LOWER(email) = ${email} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
        ORDER BY id DESC LIMIT 1
      `;
        const invite = invites[0];
        if (!invite)
            throw new FamilyError(404, 'Zaproszenie nie istnieje lub wygasło.');
        if (invite.email.trim().toLowerCase() !== email) {
            throw new FamilyError(403, 'To zaproszenie zostało wystawione na inny adres e-mail.');
        }
        yield prisma.$transaction([
            prisma.$executeRaw `
      INSERT INTO FamilyMember(groupId, userId, role, status, joinedAt)
      VALUES (${Number(invite.groupId)}, ${userId}, 'member', 'active', ${nowIso})
    `,
            prisma.$executeRaw `
      UPDATE FamilyInvite SET acceptedAt = ${nowIso} WHERE id = ${Number(invite.id)}
    `,
        ]);
    });
}
/** Removes a member (by host) or lets a member leave the family group. */
function removeFamilyMember(prisma, actorUserId, targetUserId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, familyAccess_1.ensureFamilySchema)(prisma);
        const actorRows = yield prisma.$queryRaw `
    SELECT groupId, role FROM FamilyMember WHERE userId = ${actorUserId} AND status = 'active' LIMIT 1
  `;
        const actor = actorRows[0];
        if (!actor)
            throw new FamilyError(404, 'Nie należysz do żadnej grupy rodzinnej.');
        const groupId = Number(actor.groupId);
        if (actorUserId !== targetUserId && actor.role !== 'host') {
            throw new FamilyError(403, 'Tylko gospodarz może usuwać innych domowników.');
        }
        if (actorUserId === targetUserId && actor.role === 'host') {
            throw new FamilyError(400, 'Gospodarz nie może opuścić własnej grupy, dopóki są w niej domownicy.');
        }
        yield prisma.$executeRaw `
    DELETE FROM FamilyMember WHERE groupId = ${groupId} AND userId = ${targetUserId}
  `;
    });
}
/** Cancels a pending invite (host only). */
function cancelFamilyInvite(prisma, hostUserId, inviteId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, familyAccess_1.ensureFamilySchema)(prisma);
        const actorRows = yield prisma.$queryRaw `
    SELECT groupId, role FROM FamilyMember WHERE userId = ${hostUserId} AND status = 'active' LIMIT 1
  `;
        const actor = actorRows[0];
        if (!actor || actor.role !== 'host') {
            throw new FamilyError(403, 'Tylko gospodarz może anulować zaproszenia.');
        }
        yield prisma.$executeRaw `
    DELETE FROM FamilyInvite WHERE id = ${inviteId} AND groupId = ${Number(actor.groupId)} AND acceptedAt IS NULL
  `;
    });
}
