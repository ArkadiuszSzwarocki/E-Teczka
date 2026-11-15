const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { activeSessionWhere, effectiveSessionExpiry, SESSION_DURATION_MS } = require('../services/sessionPolicy');
const { createSession, createAuthRouter } = require('../routes/auth');

test('new sessions last twenty minutes and old longer sessions are capped by creation time', async () => {
  let saved;
  const prisma = { subscription: { findUnique: async () => null }, authSession: { findMany: async () => [], create: async ({ data }) => { saved = data; } } };
  const before = Date.now();
  const session = await createSession(prisma, 42, 'session@example.com', null, { deviceId: 'test-desktop' });
  assert.ok(session.expiresAt.getTime() >= before + 20 * 60000);
  assert.ok(session.expiresAt.getTime() <= Date.now() + 20 * 60000);
  assert.equal(saved.expiresAt, session.expiresAt);
  const created = new Date('2026-11-15T12:00:00Z');
  assert.equal(effectiveSessionExpiry(created, new Date('2026-12-15T12:00:00Z')).toISOString(), '2026-11-15T12:20:00.000Z');
  assert.equal(activeSessionWhere(new Date('2026-11-15T12:20:00Z')).createdAt.gt.getTime(), created.getTime());
  assert.equal(SESSION_DURATION_MS, 1200000);
});

test('session check returns its deadline and rejects an expired old session', async () => {
  let row = { createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000), user: { id: 42, email: 'session@example.com', name: null } };
  const prisma = { authSession: { findFirst: async ({ where }) => row.createdAt > where.createdAt.gt && row.expiresAt > where.expiresAt.gt ? row : null } };
  const app = express(); app.use('/auth', createAuthRouter(prisma));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const check = () => fetch(`http://127.0.0.1:${server.address().port}/auth/me`, { headers: { authorization: 'Bearer test-session' } });
  try {
    const response = await check(); assert.equal(response.status, 200);
    assert.equal((await response.json()).expiresAt, new Date(row.createdAt.getTime() + SESSION_DURATION_MS).toISOString());
    row = { ...row, createdAt: new Date(Date.now() - SESSION_DURATION_MS - 1) };
    assert.equal((await check()).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
