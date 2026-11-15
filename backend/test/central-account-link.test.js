const test = require('node:test');
const assert = require('node:assert/strict');
const { centralAccountOrigin, verifyCentralSession, createCentralAccountLinks } = require('../services/centralAccountLink');
const { DatabaseSync } = require('node:sqlite');

test('central account session is sent only to the configured HTTPS origin', async () => {
  assert.equal(centralAccountOrigin('http://example.com'), null);
  assert.equal(centralAccountOrigin('https://user:password@example.com'), null);
  assert.equal(centralAccountOrigin('https://example.com/path'), null);
  assert.equal(centralAccountOrigin('https://example.com'), 'https://example.com');
  let called = 0;
  const fake = async (url, options) => { called++; assert.equal(url, 'https://example.com/me'); assert.equal(options.redirect, 'error'); return { ok: true, json: async () => ({ id: 'a'.repeat(32), email: 'u@example.com', name: null }) }; };
  await assert.rejects(verifyCentralSession('http://example.com', 'a'.repeat(43), fake));
  await assert.rejects(verifyCentralSession('https://example.com', 'invalid', fake));
  assert.equal(called, 0);
  assert.equal((await verifyCentralSession('https://example.com/', 'a'.repeat(43), fake)).id, 'a'.repeat(32));
  assert.equal(called, 1);
  await assert.rejects(verifyCentralSession('https://example.com', 'a'.repeat(43), async () => ({ ok: true, json: async () => ({ id: '1', email: 'u@example.com', name: null }) })));
});

test('local accounts are linked only by explicit verified IDs and stay isolated', async () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE User (id INTEGER PRIMARY KEY); INSERT INTO User VALUES (1), (2)');
  const sql = strings => strings.join('?');
  const prisma = {
    $executeRawUnsafe: async value => { db.exec(value); return 0; },
    $executeRaw: async (strings, ...values) => Number(db.prepare(sql(strings)).run(...values).changes),
    $queryRaw: async (strings, ...values) => db.prepare(sql(strings)).all(...values)
  };
  try {
    const links = createCentralAccountLinks(prisma);
    await links.link('https://accounts.example.com', 'a'.repeat(32), 1);
    assert.equal(await links.find('https://accounts.example.com', 'a'.repeat(32)), 1);
    assert.equal(await links.find('https://other.example.com', 'a'.repeat(32)), null);
    await assert.rejects(links.link('https://accounts.example.com', 'a'.repeat(32), 2));
    await assert.rejects(links.link('https://accounts.example.com', 'b'.repeat(32), 1));
    assert.equal(await links.unlink('https://accounts.example.com', 'a'.repeat(32), 2), false);
    assert.equal(await links.unlink('https://accounts.example.com', 'a'.repeat(32), 1), true);
    assert.equal(await links.find('https://accounts.example.com', 'a'.repeat(32)), null);
  } finally { db.close(); }
});

test('linking requires a live local account session', async () => {
  const prisma = { authSession: { findFirst: async args => args.where.tokenHash === require('node:crypto').createHash('sha256').update('valid').digest('hex') ? { userId: 42 } : null } };
  const links = createCentralAccountLinks(prisma);
  assert.equal(await links.localUserId('valid'), 42);
  assert.equal(await links.localUserId('wrong'), null);
  assert.equal(await links.localUserId(''), null);
});
