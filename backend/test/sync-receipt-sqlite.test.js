const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { withSyncReceipt } = require('../services/syncReceipt.js');

test('SQLite receipt and operation commit together and replay safely', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-sync-test-'));
  const db = path.join(dir, 'test.db').replace(/\\/g, '/');
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
  try {
    const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261111000000_sync_operations/migration.sql'), 'utf8');
    for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe('CREATE TABLE "TestFolder" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL)');
    const create = tx => tx.$executeRaw`INSERT INTO TestFolder (name) VALUES ('Folder')`;
    const first = await withSyncReceipt(prisma, 'user:1', 'one', { name: 'Folder' }, create);
    const second = await withSyncReceipt(prisma, 'user:1', 'one', { name: 'Folder' }, create);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.equal((await prisma.$queryRaw`SELECT COUNT(*) AS count FROM TestFolder`)[0].count, 1n);
    await assert.rejects(withSyncReceipt(prisma, 'user:1', 'two', {}, async tx => {
      await tx.$executeRaw`INSERT INTO TestFolder (name) VALUES ('Rollback')`;
      throw new Error('test rollback');
    }));
    assert.equal((await prisma.$queryRaw`SELECT COUNT(*) AS count FROM TestFolder`)[0].count, 1n);
    assert.equal((await prisma.$queryRaw`SELECT COUNT(*) AS count FROM SyncOperation`)[0].count, 1n);
  } finally {
    await prisma.$disconnect();
    if (fs.existsSync(db)) fs.unlinkSync(db);
    fs.rmdirSync(dir);
  }
});
