import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

function matches(password: string, salt: string, expectedHex: string): boolean {
  if (!password || password.length > 200 || !/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
  const actual = crypto.scryptSync(password, salt, 64); const expected = Buffer.from(expectedHex, 'hex');
  return crypto.timingSafeEqual(actual, expected);
}
export async function verifyBackupPrimary(prisma: PrismaClient, owner: string, password: string): Promise<boolean> {
  if (owner.startsWith('user:')) {
    const id = Number(owner.slice(5)); if (!Number.isSafeInteger(id) || id <= 0) return false;
    const user = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
    const [salt, hash] = (user?.passwordHash || '').split(':'); return matches(password, salt || '', hash || '');
  }
  if (owner !== 'desktop-local' || !process.env.APPDATA) return false;
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'mojateczka', 'access-lock.json'), 'utf8')) as { salt?: string; hash?: string };
    return matches(password, lock.salt || '', lock.hash || '');
  } catch { return false; }
}
