"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devPlansEnabled = devPlansEnabled;
exports.devPlan = devPlan;
exports.setDevPlan = setDevPlan;
exports.accountingKey = accountingKey;
const overrides = new Map();
function devPlansEnabled() {
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    return (process.env.ETECZKA_DEV_PLANS === '1' || process.env.ETECZKA_PUBLIC_TEST_MODE === '1') && process.env.NODE_ENV !== 'production' && (!stripeKey || stripeKey.startsWith('sk_test_'));
}
function devPlan(ownerKey) { return devPlansEnabled() ? overrides.get(ownerKey) : undefined; }
function setDevPlan(ownerKey, plan) { if (plan === null)
    overrides.delete(ownerKey);
else
    overrides.set(ownerKey, plan); }
function accountingKey(ownerKey) { return devPlan(ownerKey) === undefined ? ownerKey : `dev-test:${ownerKey}`; }
