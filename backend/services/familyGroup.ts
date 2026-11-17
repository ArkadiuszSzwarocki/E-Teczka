import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ensureFamilySchema } from './familyAccess';
import { getCatalog } from './planCatalog';
import { getPlan } from './planLedger';

export class FamilyError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export type FamilyMemberInfo = {
  userId: number;
  email: string;
  name: string | null;
  role: 'host' | 'member';
  joinedAt: string;
};

export type FamilyPendingInvite = {
  id: number;
  email: string;
  code: string;
  expiresAt: string;
};

export type IncomingFamilyInvite = {
  id: number;
  hostEmail: string;
  hostName: string | null;
  code: string;
  expiresAt: string;
};

export type FamilyOverview = {
  group: {
    id: number;
    hostUserId: number;
    role: 'host' | 'member';
    maxMembers: number;
    members: FamilyMemberInfo[];
    pendingInvites: FamilyPendingInvite[];
  } | null;
  incomingInvites: IncomingFamilyInvite[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the current user's family group, active members, sent invites, and incoming invites. */
export async function getFamilyOverview(prisma: PrismaClient, userId: number): Promise<FamilyOverview> {
  await ensureFamilySchema(prisma);
  const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  const nowIso = new Date().toISOString();

  const membership = await prisma.$queryRaw<Array<{ groupId: number; role: string }>>`
    SELECT groupId, role FROM FamilyMember WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `;

  let group: FamilyOverview['group'] = null;
  if (membership[0]) {
    const groupId = Number(membership[0].groupId);
    const groupRows = await prisma.$queryRaw<Array<{ id: number; hostUserId: number }>>`
      SELECT id, hostUserId FROM FamilyGroup WHERE id = ${groupId} LIMIT 1
    `;
    if (groupRows[0]) {
      const memberRows = await prisma.$queryRaw<Array<{ userId: number; role: string; joinedAt: string }>>`
        SELECT userId, role, joinedAt FROM FamilyMember WHERE groupId = ${groupId} AND status = 'active' ORDER BY id ASC
      `;
      const users = await prisma.user.findMany({
        where: { id: { in: memberRows.map(m => Number(m.userId)) } },
        select: { id: true, email: true, name: true },
      });
      const userMap = new Map(users.map(u => [u.id, u]));
      const role = Number(groupRows[0].hostUserId) === userId ? 'host' : 'member';
      const pendingInvites = role === 'host'
        ? await prisma.$queryRaw<Array<FamilyPendingInvite>>`
            SELECT id, email, code, expiresAt FROM FamilyInvite
            WHERE groupId = ${groupId} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
            ORDER BY id DESC
          `
        : [];
      const maxMembers = getCatalog().plans.family?.mobileDevices ?? 4;
      group = {
        id: groupId,
        hostUserId: Number(groupRows[0].hostUserId),
        role,
        maxMembers,
        members: memberRows.map(m => {
          const u = userMap.get(Number(m.userId));
          return {
            userId: Number(m.userId),
            email: u?.email ?? `uzytkownik-${m.userId}`,
            name: u?.name ?? null,
            role: m.role === 'host' ? 'host' : 'member',
            joinedAt: m.joinedAt,
          };
        }),
        pendingInvites,
      };
    }
  }

  const normalizedEmail = currentUser?.email.trim().toLowerCase() ?? '';
  const incomingInvites = normalizedEmail
    ? await prisma.$queryRaw<Array<IncomingFamilyInvite>>`
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
}

/** Creates a 7-day invitation for a family member (requires host to be on Family plan). */
export async function createFamilyInvite(prisma: PrismaClient, hostUserId: number, emailRaw: string): Promise<FamilyPendingInvite> {
  await ensureFamilySchema(prisma);
  const email = emailRaw.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new FamilyError(400, 'Podaj poprawny adres e-mail osoby do zaproszenia.');
  }

  const hostPlan = await getPlan(prisma, `user:${hostUserId}`);
  if (hostPlan !== 'family' && hostPlan !== 'business') {
    throw new FamilyError(403, 'Zapraszanie domowników wymaga aktywnego planu Rodzinny.');
  }

  const host = await prisma.user.findUnique({ where: { id: hostUserId }, select: { id: true, email: true } });
  if (!host) throw new FamilyError(404, 'Nie znaleziono konta gospodarza.');
  if (host.email.trim().toLowerCase() === email) {
    throw new FamilyError(400, 'Nie możesz zaprosić samego siebie.');
  }

  const existingMembership = await prisma.$queryRaw<Array<{ groupId: number; role: string }>>`
    SELECT groupId, role FROM FamilyMember WHERE userId = ${hostUserId} AND status = 'active' LIMIT 1
  `;
  let groupId = existingMembership[0]?.groupId ? Number(existingMembership[0].groupId) : 0;
  if (groupId && existingMembership[0]?.role !== 'host') {
    throw new FamilyError(403, 'Tylko gospodarz grupy rodzinnej może wysyłać zaproszenia.');
  }

  const nowIso = new Date().toISOString();
  if (!groupId) {
    await prisma.$executeRaw`
      INSERT OR IGNORE INTO FamilyGroup(hostUserId, createdAt) VALUES (${hostUserId}, ${nowIso})
    `;
    const createdGroup = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM FamilyGroup WHERE hostUserId = ${hostUserId} LIMIT 1
    `;
    groupId = Number(createdGroup[0].id);
    await prisma.$executeRaw`
      INSERT OR IGNORE INTO FamilyMember(groupId, userId, role, status, joinedAt)
      VALUES (${groupId}, ${hostUserId}, 'host', 'active', ${nowIso})
    `;
  }

  const targetUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (targetUser) {
    const targetMembership = await prisma.$queryRaw<Array<{ groupId: number }>>`
      SELECT groupId FROM FamilyMember WHERE userId = ${targetUser.id} AND status = 'active' LIMIT 1
    `;
    if (targetMembership[0]) {
      throw new FamilyError(409, 'Ta osoba należy już do grupy rodzinnej.');
    }
  }

  const maxMembers = getCatalog().plans.family?.mobileDevices ?? 4;
  const activeCountRows = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*) AS cnt FROM FamilyMember WHERE groupId = ${groupId} AND status = 'active'
  `;
  const pendingRows = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*) AS cnt FROM FamilyInvite WHERE groupId = ${groupId} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
  `;
  if (Number(activeCountRows[0]?.cnt ?? 0) + Number(pendingRows[0]?.cnt ?? 0) >= maxMembers) {
    throw new FamilyError(409, `Osiągnięto limit miejsc w grupie rodzinnej (${maxMembers}).`);
  }

  const duplicateRows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM FamilyInvite
    WHERE groupId = ${groupId} AND LOWER(email) = ${email} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
    LIMIT 1
  `;
  if (duplicateRows[0]) {
    throw new FamilyError(409, 'Aktywne zaproszenie dla tego adresu e-mail już istnieje.');
  }

  const code = crypto.randomBytes(5).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await prisma.$executeRaw`
    INSERT INTO FamilyInvite(groupId, email, code, createdByUserId, expiresAt, createdAt)
    VALUES (${groupId}, ${email}, ${code}, ${hostUserId}, ${expiresAt}, ${nowIso})
  `;
  const inserted = await prisma.$queryRaw<Array<FamilyPendingInvite>>`
    SELECT id, email, code, expiresAt FROM FamilyInvite WHERE code = ${code} LIMIT 1
  `;
  return inserted[0];
}

/** Accepts a pending family invitation by invite code (and matches invited email if code not specified). */
export async function acceptFamilyInvite(prisma: PrismaClient, userId: number, codeRaw: string): Promise<void> {
  await ensureFamilySchema(prisma);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw new FamilyError(404, 'Nie znaleziono konta użytkownika.');

  const already = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM FamilyMember WHERE userId = ${userId} AND status = 'active' LIMIT 1
  `;
  if (already[0]) throw new FamilyError(409, 'Należysz już do grupy rodzinnej.');

  const code = codeRaw.trim().toUpperCase();
  const nowIso = new Date().toISOString();
  const email = user.email.trim().toLowerCase();
  const invites = code
    ? await prisma.$queryRaw<Array<{ id: number; groupId: number; email: string }>>`
        SELECT id, groupId, email FROM FamilyInvite
        WHERE code = ${code} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
        LIMIT 1
      `
    : await prisma.$queryRaw<Array<{ id: number; groupId: number; email: string }>>`
        SELECT id, groupId, email FROM FamilyInvite
        WHERE LOWER(email) = ${email} AND acceptedAt IS NULL AND expiresAt > ${nowIso}
        ORDER BY id DESC LIMIT 1
      `;

  const invite = invites[0];
  if (!invite) throw new FamilyError(404, 'Zaproszenie nie istnieje lub wygasło.');
  if (invite.email.trim().toLowerCase() !== email) {
    throw new FamilyError(403, 'To zaproszenie zostało wystawione na inny adres e-mail.');
  }

  await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO FamilyMember(groupId, userId, role, status, joinedAt)
      VALUES (${Number(invite.groupId)}, ${userId}, 'member', 'active', ${nowIso})
    `,
    prisma.$executeRaw`
      UPDATE FamilyInvite SET acceptedAt = ${nowIso} WHERE id = ${Number(invite.id)}
    `,
  ]);
}

/** Removes a member (by host) or lets a member leave the family group. */
export async function removeFamilyMember(prisma: PrismaClient, actorUserId: number, targetUserId: number): Promise<void> {
  await ensureFamilySchema(prisma);
  const actorRows = await prisma.$queryRaw<Array<{ groupId: number; role: string }>>`
    SELECT groupId, role FROM FamilyMember WHERE userId = ${actorUserId} AND status = 'active' LIMIT 1
  `;
  const actor = actorRows[0];
  if (!actor) throw new FamilyError(404, 'Nie należysz do żadnej grupy rodzinnej.');

  const groupId = Number(actor.groupId);
  if (actorUserId !== targetUserId && actor.role !== 'host') {
    throw new FamilyError(403, 'Tylko gospodarz może usuwać innych domowników.');
  }
  if (actorUserId === targetUserId && actor.role === 'host') {
    throw new FamilyError(400, 'Gospodarz nie może opuścić własnej grupy, dopóki są w niej domownicy.');
  }

  await prisma.$executeRaw`
    DELETE FROM FamilyMember WHERE groupId = ${groupId} AND userId = ${targetUserId}
  `;
}

/** Cancels a pending invite (host only). */
export async function cancelFamilyInvite(prisma: PrismaClient, hostUserId: number, inviteId: number): Promise<void> {
  await ensureFamilySchema(prisma);
  const actorRows = await prisma.$queryRaw<Array<{ groupId: number; role: string }>>`
    SELECT groupId, role FROM FamilyMember WHERE userId = ${hostUserId} AND status = 'active' LIMIT 1
  `;
  const actor = actorRows[0];
  if (!actor || actor.role !== 'host') {
    throw new FamilyError(403, 'Tylko gospodarz może anulować zaproszenia.');
  }
  await prisma.$executeRaw`
    DELETE FROM FamilyInvite WHERE id = ${inviteId} AND groupId = ${Number(actor.groupId)} AND acceptedAt IS NULL
  `;
}
