const test = require('node:test');
const assert = require('node:assert/strict');
const { latestScheduledTime, backupDue, createBackupScheduler } = require('../services/backupScheduler');

test('daily and weekly schedules use selected local time and retain old settings', () => {
  const t = new Date(2026, 10, 16, 10, 0); // Monday
  assert.equal(latestScheduledTime('daily@09:30', t).getTime(), new Date(2026, 10, 16, 9, 30).getTime());
  assert.equal(latestScheduledTime('daily', t).getTime(), new Date(2026, 10, 16, 2, 15).getTime());
  assert.equal(latestScheduledTime('weekly@11:00', t).getTime(), new Date(2026, 10, 9, 11, 0).getTime());
  assert.equal(latestScheduledTime('daily@25:00', t), null);
  const base = { schedule: 'daily@09:30', createdAt: new Date(2026, 10, 15), lastBackupAt: null, lastBackupStatus: null };
  assert.equal(backupDue(base, t), true);
  assert.equal(backupDue({ ...base, lastBackupAt: new Date(2026, 10, 16, 9, 31), lastBackupStatus: 'success' }, t), false);
  assert.equal(backupDue({ ...base, lastBackupAt: new Date(2026, 10, 16, 9, 45), lastBackupStatus: 'failed' }, t), false);
  assert.equal(backupDue({ ...base, lastBackupAt: new Date(2026, 10, 16, 9, 45), lastBackupStatus: 'failed' }, new Date(2026, 10, 16, 10, 46)), true);
  assert.equal(backupDue({ ...base, createdAt: new Date(2026, 10, 16, 9, 45) }, t), false);
});

test('scheduler prevents overlapping runs and records the result', async () => {
  const destination = { id: 5, ownerKey: 'user:7', schedule: 'daily@02:15', createdAt: new Date(2026, 10, 1), lastBackupAt: null, lastBackupStatus: null };
  const writes = []; let calls = 0; let release;
  const prisma = { backupDestination: { findMany: async () => [destination], update: async args => writes.push(args) }, subscription: { findUnique: async () => ({ plan: 'premium', status: 'active' }) }, backupRun: { create: async () => ({ id: 2 }), update: async args => writes.push(args) } };
  const run = createBackupScheduler(prisma, async (_db, owner, id) => { calls++; assert.equal(owner, 'user:7'); assert.equal(id, 7); await new Promise(resolve => { release = resolve; }); return true; });
  const first = run(new Date(2026, 10, 16, 10)); await new Promise(resolve => setImmediate(resolve));
  await run(new Date(2026, 10, 16, 10)); assert.equal(calls, 1); release(); await first;
  assert.equal(writes[0].data.status, 'success'); assert.equal(writes[1].data.lastBackupStatus, 'success');
});
