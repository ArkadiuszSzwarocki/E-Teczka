const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Stripe = require('stripe');
const { createBillingWebhookHandler } = require('../routes/billing.js');

test('late failed-payment event cannot downgrade a different active subscription', async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'test-secret';
  let writes = 0;
  const stripe = {
    webhooks: { constructEvent: () => ({ type: 'invoice.payment_failed', data: { object: { subscription: 'old-sub' } } }) },
    subscriptions: { retrieve: async () => ({ id: 'old-sub', customer: 'cus-test', metadata: { ownerKey: 'user:1' }, status: 'past_due' }) },
  };
  const prisma = { subscription: { findUnique: async () => ({ providerSubscriptionId: 'new-sub', status: 'active' }), upsert: async () => { writes++; } } };
  const app = express();
  app.post('/webhook', express.raw({ type: 'application/json' }), createBillingWebhookHandler(prisma, () => stripe));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 'test' }, body: '{}' });
    assert.equal(response.status, 200);
    assert.equal(writes, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});

test('webhook rejects an invalid signature and accepts a valid raw signed payload', async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secret = 'whsec_test_local_only';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  const actualStripe = new Stripe('sk_test_local_only');
  const prisma = {};
  const app = express();
  app.post('/webhook', express.raw({ type: 'application/json' }), createBillingWebhookHandler(prisma, () => actualStripe));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const payload = JSON.stringify({ id: 'evt_test', type: 'test.unhandled', data: { object: {} } });
    const signature = actualStripe.webhooks.generateTestHeaderString({ payload, secret });
    const send = sig => fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: payload });
    assert.equal((await send('invalid')).status, 400);
    assert.equal((await send(signature)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});

test('checkout webhook does not activate canceled or unpaid subscriptions', async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'test-secret';
  let writes = 0;
  let paymentStatus = 'paid';
  let lookups = 0;
  const stripe = {
    webhooks: { constructEvent: () => ({ type: 'checkout.session.completed', data: { object: { id: 'cs-test', subscription: 'sub-test', customer: 'cus-test', metadata: { ownerKey: 'user:1' }, payment_status: paymentStatus } } }) },
    subscriptions: { retrieve: async () => { lookups++; return { id: 'sub-test', metadata: { ownerKey: 'user:1' }, status: 'canceled' }; } },
  };
  const prisma = { subscription: { findUnique: async () => null, upsert: async () => { writes++; } }, billingTransaction: { upsert: async () => { writes++; } } };
  const app = express();
  app.post('/webhook', express.raw({ type: 'application/json' }), createBillingWebhookHandler(prisma, () => stripe));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const send = () => fetch(`http://127.0.0.1:${server.address().port}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 'test' }, body: '{}' });
    assert.equal((await send()).status, 200);
    assert.equal(lookups, 1);
    paymentStatus = 'unpaid';
    assert.equal((await send()).status, 200);
    assert.equal(lookups, 1);
    assert.equal(writes, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});

test('paid checkout replaces only a verified canceled-at-end subscription', async () => {
 const oldSecret=process.env.STRIPE_WEBHOOK_SECRET;process.env.STRIPE_WEBHOOK_SECRET='test-secret';let writes=0;let scheduled=true;let replacement='old-sub';let update;
 const stripe={webhooks:{constructEvent:()=>({type:'checkout.session.completed',data:{object:{id:'cs-new',subscription:'new-sub',customer:'cus',payment_status:'paid',metadata:{ownerKey:'user:1',plan:'standard',replacesSubscriptionId:replacement}}}})},subscriptions:{retrieve:async(id)=>id==='new-sub'?{id,metadata:{ownerKey:'user:1'},status:'active',items:{data:[{current_period_end:2000000000}]}}:{id,metadata:{ownerKey:'user:1'},status:'active',cancel_at_period_end:scheduled}}};
 const prisma={subscription:{findUnique:async()=>({providerSubscriptionId:'old-sub',status:'active',cancelAtPeriodEnd:true}),upsert:async args=>{writes++;update=args.update}},billingTransaction:{upsert:async()=>({})}};
 const app=express();app.post('/webhook',express.raw({type:'application/json'}),createBillingWebhookHandler(prisma,()=>stripe));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 try{const send=()=>fetch(`http://127.0.0.1:${server.address().port}/webhook`,{method:'POST',headers:{'content-type':'application/json','stripe-signature':'test'},body:'{}'});replacement='other-sub';await send();assert.equal(writes,0);replacement='old-sub';scheduled=false;await send();assert.equal(writes,0);scheduled=true;assert.equal((await send()).status,200);assert.equal(writes,1);assert.equal(update.plan,'standard');assert.equal(update.cancelAtPeriodEnd,false);assert.equal(update.providerSubscriptionId,'new-sub');}finally{await new Promise(resolve=>server.close(resolve));if(oldSecret===undefined)delete process.env.STRIPE_WEBHOOK_SECRET;else process.env.STRIPE_WEBHOOK_SECRET=oldSecret;}
});
