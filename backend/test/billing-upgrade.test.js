const test = require('node:test'); const assert = require('node:assert/strict'); const express = require('express');
const { createBillingRouter } = require('../routes/billing');
test('upgrade confirms the existing subscription and activates only after the invoice is paid', async () => {
 const oldPrice=process.env.STRIPE_PRICE_MONTHLY; process.env.STRIPE_PRICE_MONTHLY='price_premium_test';
 let invoiceStatus='open', writes=0, portalArgs;
 const existing={plan:'standard',status:'active',cancelAtPeriodEnd:false,providerSubscriptionId:'sub_1',providerCustomerId:'cus_1'};
 const subscription={id:'sub_1',customer:'cus_1',metadata:{ownerKey:'user:1',plan:'standard'},status:'active',latest_invoice:'in_1',items:{data:[{id:'si_1',quantity:1,price:{id:'price_premium_test'},current_period_end:1800000000}]}};
 const stripe={subscriptions:{retrieve:async()=>subscription}, invoices:{retrieve:async()=>({status:invoiceStatus})}, billingPortal:{sessions:{create:async args=>{portalArgs=args;return {url:'https://billing.stripe.com/session/test'};}}}};
 const prisma={subscription:{findUnique:async()=>existing,updateMany:async()=>{writes++;return {count:1}}}};
 const app=express();app.use(express.json());app.use((req,res,next)=>{res.locals.billingOwnerKey='user:1';next()});app.use('/billing',createBillingRouter(prisma,()=>stripe));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))}); const base=`http://127.0.0.1:${server.address().port}/billing`;
 try {
  let r=await fetch(base+'/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan:'premium',interval:'monthly'})}); assert.equal(r.status,200); assert.equal((await r.json()).kind,'upgrade'); assert.equal(portalArgs.flow_data.subscription_update_confirm.subscription,'sub_1'); assert.equal(portalArgs.flow_data.subscription_update_confirm.items[0].price,'price_premium_test'); assert.equal(writes,0);
  r=await fetch(base+'/sync-upgrade',{method:'POST'}); assert.equal((await r.json()).upgraded,false); assert.equal(writes,0);
  invoiceStatus='paid';r=await fetch(base+'/sync-upgrade',{method:'POST'}); assert.equal((await r.json()).upgraded,true);assert.equal(writes,1);
  subscription.metadata.ownerKey='user:2';r=await fetch(base+'/checkout',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan:'premium'})});assert.equal(r.status,409);assert.equal(writes,1);
 } finally { await new Promise(resolve=>server.close(resolve)); if(oldPrice===undefined) delete process.env.STRIPE_PRICE_MONTHLY; else process.env.STRIPE_PRICE_MONTHLY=oldPrice; }
});
