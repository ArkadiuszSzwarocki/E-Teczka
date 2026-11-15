const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createBillingRouter } = require('../routes/billing');

test('new Stripe checkout is disabled while Google Play is being integrated', async () => {
  const app = express(); app.use(express.json()); app.use('/billing', createBillingRouter({}, () => { throw Error('Stripe must not be called'); }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/billing/checkout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'premium' }) });
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'GOOGLE_PLAY_PENDING');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
