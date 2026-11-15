import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

type RemoteUser = { id: string; email: string; name: string | null };

export function centralAccountOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null; }
  catch { return null; }
}

export async function verifyCentralSession(origin: string, token: string, request: typeof fetch = fetch): Promise<RemoteUser> {
  const safeOrigin = centralAccountOrigin(origin);
  if (!safeOrigin || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('INVALID_SESSION');
  const response = await request(`${safeOrigin}/me`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('INVALID_SESSION');
  const user = await response.json() as Partial<RemoteUser>;
  if (typeof user.id !== 'string' || !/^[a-f0-9]{32}$/.test(user.id) || typeof user.email !== 'string' || !user.email || (user.name !== null && typeof user.name !== 'string')) throw new Error('INVALID_SESSION');
  return { id: user.id, email: user.email, name: user.name };
}

export function createCentralAccountLinks(prisma: PrismaClient) {
  const table = () => prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS CentralAccountLink (centralOrigin TEXT NOT NULL, centralId TEXT NOT NULL, localUserId INTEGER NOT NULL UNIQUE, createdAt TEXT NOT NULL, PRIMARY KEY(centralOrigin, centralId), FOREIGN KEY(localUserId) REFERENCES User(id))');
  return {
    async localUserId(localToken: string): Promise<number | null> {
      if (typeof localToken !== 'string' || localToken.length < 1 || localToken.length > 4096) return null;
      const tokenHash = createHash('sha256').update(localToken).digest('hex');
      const session = await prisma.authSession.findFirst({ where: { tokenHash, expiresAt: { gt: new Date() } }, select: { userId: true } });
      return session?.userId ?? null;
    },
    async link(origin: string, centralId: string, localUserId: number) {
      await table();
      await prisma.$executeRaw`INSERT INTO CentralAccountLink(centralOrigin, centralId, localUserId, createdAt) VALUES (${origin}, ${centralId}, ${localUserId}, ${new Date().toISOString()})`;
    },
    async find(origin: string, centralId: string): Promise<number | null> {
      await table();
      const rows = await prisma.$queryRaw<Array<{localUserId: number}>>`SELECT localUserId FROM CentralAccountLink WHERE centralOrigin = ${origin} AND centralId = ${centralId}`;
      return rows[0]?.localUserId ?? null;
    },
    async unlink(origin: string, centralId: string, localUserId: number): Promise<boolean> {
      await table();
      const changed = await prisma.$executeRaw`DELETE FROM CentralAccountLink WHERE centralOrigin = ${origin} AND centralId = ${centralId} AND localUserId = ${localUserId}`;
      return changed === 1;
    }
  };
}
