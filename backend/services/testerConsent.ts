import type { PrismaClient } from '@prisma/client';

export type TesterStorageMode = 'local_disk' | 'local_browser' | 'qnap_server';

export type TesterConsentRecord = {
  userId: number;
  email: string;
  accepted: boolean;
  storageMode: TesterStorageMode;
  policyVersion: string;
  acceptedAt: string;
};

export const CURRENT_TESTER_POLICY_VERSION = '2026-11-17-disk';

let schemaReady: Promise<void> | null = null;

/** Ensures the TesterConsent table exists in SQLite. */
export async function ensureTesterConsentSchema(prisma: PrismaClient): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await prisma.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS TesterConsent (userId INTEGER PRIMARY KEY, email TEXT NOT NULL, accepted INTEGER NOT NULL, storageMode TEXT NOT NULL, policyVersion TEXT NOT NULL, acceptedAt TEXT NOT NULL)',
      );
    })();
  }
  await schemaReady;
}

export function isTesterConsentRequired(): boolean {
  return process.env.MOJATECZKA_PUBLIC_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
}

/** Reads stored tester consent for a user from the QNAP/server database. */
export async function getTesterConsent(prisma: PrismaClient, userId: number): Promise<{ required: boolean; needsConsent: boolean; consent: TesterConsentRecord | null }> {
  await ensureTesterConsentSchema(prisma);
  const rows = await prisma.$queryRaw<Array<{
    userId: number;
    email: string;
    accepted: number;
    storageMode: string;
    policyVersion: string;
    acceptedAt: string;
  }>>`
    SELECT userId, email, accepted, storageMode, policyVersion, acceptedAt
    FROM TesterConsent
    WHERE userId = ${userId}
    LIMIT 1
  `;
  const row = rows[0];
  const consent: TesterConsentRecord | null = row
    ? {
        userId: Number(row.userId),
        email: row.email,
        accepted: Boolean(row.accepted),
        storageMode: row.storageMode === 'qnap_server'
          ? 'qnap_server'
          : row.storageMode === 'local_browser'
            ? 'local_browser'
            : 'local_disk',
        policyVersion: row.policyVersion,
        acceptedAt: row.acceptedAt,
      }
    : null;
  const required = isTesterConsentRequired();
  const needsConsent = required && (
    !consent
    || !consent.accepted
    || consent.storageMode === 'local_browser'
    || consent.policyVersion !== CURRENT_TESTER_POLICY_VERSION
  );
  return { required, needsConsent, consent };
}

/** Records tester consent decision in the QNAP/server database. */
export async function saveTesterConsent(
  prisma: PrismaClient,
  userId: number,
  input: { accepted: boolean; storageMode: TesterStorageMode },
): Promise<TesterConsentRecord> {
  await ensureTesterConsentSchema(prisma);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const email = user?.email ?? `user-${userId}`;
  const acceptedInt = input.accepted ? 1 : 0;
  const acceptedAt = new Date().toISOString();
  await prisma.$executeRaw`
    INSERT INTO TesterConsent(userId, email, accepted, storageMode, policyVersion, acceptedAt)
    VALUES (${userId}, ${email}, ${acceptedInt}, ${input.storageMode}, ${CURRENT_TESTER_POLICY_VERSION}, ${acceptedAt})
    ON CONFLICT(userId) DO UPDATE SET
      email = excluded.email,
      accepted = excluded.accepted,
      storageMode = excluded.storageMode,
      policyVersion = excluded.policyVersion,
      acceptedAt = excluded.acceptedAt
  `;
  return {
    userId,
    email,
    accepted: input.accepted,
    storageMode: input.storageMode,
    policyVersion: CURRENT_TESTER_POLICY_VERSION,
    acceptedAt,
  };
}
