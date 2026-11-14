const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateUnusedMonthsRefund, paidAccessEndsAt } = require('../services/refundPolicy.js');

test('refund uses subscription month boundaries rather than calendar month names', () => {
  const period = { periodStart: new Date('2026-01-31T12:00:00Z'), periodEnd: new Date('2027-01-31T12:00:00Z'), amountPaid: 9990 };
  assert.deepEqual(calculateUnusedMonthsRefund(period, new Date('2026-02-01T12:00:00Z')), { billedMonths: 12, refundedMonths: 11, refundAmount: 9158 });
  assert.deepEqual(calculateUnusedMonthsRefund(period, new Date('2026-02-28T12:00:00Z')), { billedMonths: 12, refundedMonths: 10, refundAmount: 8325 });
  assert.deepEqual(calculateUnusedMonthsRefund(period, new Date('2027-01-31T12:00:00Z')), { billedMonths: 12, refundedMonths: 0, refundAmount: 0 });
});

test('monthly subscriptions have no unused complete months', () => {
  assert.deepEqual(calculateUnusedMonthsRefund({ periodStart: new Date('2026-03-01T00:00:00Z'), periodEnd: new Date('2026-04-01T00:00:00Z'), amountPaid: 999 }, new Date('2026-03-15T00:00:00Z')), { billedMonths: 1, refundedMonths: 0, refundAmount: 0 });
});

test('cancellation keeps access until the next paid month boundary', () => {
  const yearly = { periodStart: new Date('2026-01-31T12:00:00Z'), periodEnd: new Date('2027-01-31T12:00:00Z'), amountPaid: 9990 };
  assert.equal(paidAccessEndsAt(yearly, new Date('2026-02-01T12:00:00Z')).toISOString(), '2026-02-28T12:00:00.000Z');
  const monthly = { periodStart: new Date('2026-03-01T00:00:00Z'), periodEnd: new Date('2026-04-01T00:00:00Z'), amountPaid: 999 };
  assert.equal(paidAccessEndsAt(monthly, new Date('2026-03-15T00:00:00Z')).toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(paidAccessEndsAt(monthly, new Date('2026-04-01T00:00:00Z')), null);
});
