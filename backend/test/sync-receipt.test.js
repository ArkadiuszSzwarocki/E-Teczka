const test = require('node:test');
const assert = require('node:assert/strict');
const { withSyncReceipt } = require('../services/syncReceipt.js');

test('a repeated operation returns the recorded result and rejects a different payload', async () => {
  const receipts = new Map();
  const transaction = {
    $queryRaw: async (_strings, owner, id) => receipts.has(`${owner}:${id}`) ? [{ result: receipts.get(`${owner}:${id}`) }] : [],
    $executeRaw: async (_strings, owner, id, result) => { receipts.set(`${owner}:${id}`, result); },
  };
  const prisma = { $transaction: async fn => fn(transaction) };
  let calls = 0;
  const apply = async () => { calls++; return { id: 42 }; };
  assert.deepEqual(await withSyncReceipt(prisma, 'user:1', 'op-1', { name: 'Dokumenty' }, apply), { value: { id: 42 }, replayed: false });
  assert.deepEqual(await withSyncReceipt(prisma, 'user:1', 'op-1', { name: 'Dokumenty' }, apply), { value: { id: 42 }, replayed: true });
  await assert.rejects(withSyncReceipt(prisma, 'user:1', 'op-1', { name: 'Inna' }, apply));
  assert.equal(calls, 1);
});
