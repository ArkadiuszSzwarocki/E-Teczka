'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeMariaPool } = require('./mariadb/fakePool');
const { createMariaRateLimiter } = require('./mariadb/rateLimit');

test('limits attempts and resets the window without trusting forwarded headers', async () => {
  const pool = createFakeMariaPool();
  let clock = 0;
  let calls = 0;
  let blocked = 0;
  const limit = createMariaRateLimiter({ pool, limit: 2, windowMs: 1000, now: () => clock });
  const req = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.1' } };
  const res = { set() { return this; }, status(n) { assert.equal(n, 429); blocked++; return this; }, json() { return this; } };
  const next = () => { calls++; };
  await limit(req, res, next);
  await limit(req, res, next);
  req.headers['x-forwarded-for'] = '198.51.100.2';
  await limit(req, res, next);
  assert.equal(calls, 2);
  assert.equal(blocked, 1);
  clock = 1000;
  await limit(req, res, next);
  assert.equal(calls, 3);
});

test('account limit combines attempts from different addresses without storing email', async () => {
  const pool = createFakeMariaPool();
  let calls = 0;
  let blocked = 0;
  const limit = createMariaRateLimiter({ pool, limit: 1, secret: Buffer.alloc(32, 7), identity: req => req.body.email.toLowerCase() });
  const res = { locals: {}, set() { return this; }, status() { blocked++; return this; }, json() { return this; } };
  await limit({ ip: '192.0.2.1', body: { email: 'USER@example.com' } }, res, () => calls++);
  await limit({ ip: '192.0.2.2', body: { email: 'user@example.com' } }, res, () => calls++);
  assert.equal(calls, 1);
  assert.equal(blocked, 1);
  assert.equal(JSON.stringify(pool.tables.auth_rate_limits).includes('example.com'), false);
});
