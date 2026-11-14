const test = require('node:test');
const assert = require('node:assert/strict');
const { hasPremium } = require('../middleware/premium.js');
const { requirePremium } = require('../middleware/premium.js');
const express = require('express');

test('premium features require an active premium plan', async () => {
  let subscription = null;
  const prisma = { subscription: { findUnique: async () => subscription } };
  const response = { locals: { billingOwnerKey: 'user:1' } };
  assert.equal(await hasPremium(prisma, response), false);
  subscription = { plan: 'standard', status: 'active' };
  assert.equal(await hasPremium(prisma, response), false);
  subscription = { plan: 'premium', status: 'canceled' };
  assert.equal(await hasPremium(prisma, response), false);
  subscription = { plan: 'premium', status: 'active' };
  assert.equal(await hasPremium(prisma, response), true);
  subscription = { plan: 'premium', status: 'trialing' };
  assert.equal(await hasPremium(prisma, response), true);
});

test('premium route denies standard and allows active premium', async () => {
  let subscription = { plan: 'standard', status: 'active' };
  const prisma = { subscription: { findUnique: async () => subscription } };
  const app = express();
  app.get('/feature', requirePremium(prisma), (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/feature`;
    const denied = await fetch(url);
    assert.equal(denied.status, 402);
    assert.equal((await denied.json()).code, 'PREMIUM_REQUIRED');
    subscription = { plan: 'premium', status: 'active' };
    assert.equal((await fetch(url)).status, 200);
    subscription = { plan: 'premium', status: 'canceled' };
    assert.equal((await fetch(url)).status, 402);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
