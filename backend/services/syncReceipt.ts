import { createHash } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type Receipt = { result: string };
type StoredResult<T> = { payloadHash: string; value: T };

/** Execute a synchronization operation once, even if its HTTP response is lost. */
export async function withSyncReceipt<T>(
  prisma: PrismaClient,
  ownerKey: string,
  operationId: string,
  payload: unknown,
  apply: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  if (!ownerKey || !operationId || operationId.length > 128) throw new Error('Nieprawidłowy identyfikator operacji synchronizacji.');
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('Nieprawidłowe dane operacji synchronizacji.');
  const payloadHash = createHash('sha256').update(serialized).digest('hex');

  return prisma.$transaction(async transaction => {
    const rows = await transaction.$queryRaw<Receipt[]>`SELECT result FROM SyncOperation WHERE ownerKey = ${ownerKey} AND operationId = ${operationId}`;
    if (rows.length) {
      const stored = JSON.parse(rows[0].result) as StoredResult<T>;
      if (stored.payloadHash !== payloadHash) throw new Error('Identyfikator synchronizacji został użyty dla innych danych.');
      return { value: stored.value, replayed: true };
    }
    const value = await apply(transaction);
    const result = JSON.stringify({ payloadHash, value });
    await transaction.$executeRaw`INSERT INTO SyncOperation (ownerKey, operationId, result) VALUES (${ownerKey}, ${operationId}, ${result})`;
    return { value, replayed: false };
  });
}
