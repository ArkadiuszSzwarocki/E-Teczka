const test = require('node:test');
const assert = require('node:assert/strict');
const { PLAN_LIMITS, USAGE_WINDOW_MS, activePlan, trialEnd, trialAvailable } = require('../services/planPolicy');
test('plan limits match the requested weekly allowances', () => {
  assert.deepEqual(PLAN_LIMITS.free, { documents: 200, tags: 3, cameraScan: 50, printerScan: 50, merge: 10 });
  assert.deepEqual(PLAN_LIMITS.standard, { documents: 400, tags: 6, cameraScan: 100, printerScan: 100, merge: 20 });
  assert.deepEqual(PLAN_LIMITS.premium, { documents: null, tags: null, cameraScan: null, printerScan: null, merge: null });
  assert.equal(USAGE_WINDOW_MS, 604800000);
});
test('trials expire at the boundary and count calendar months safely', () => {
  const start = new Date('2026-01-31T12:00:00.000Z');
  assert.equal(trialEnd('cloudBackup', start).toISOString(), '2026-03-31T12:00:00.000Z');
  assert.equal(trialEnd('ocr', start).toISOString(), '2026-02-14T12:00:00.000Z');
  assert.equal(trialAvailable('free', 'ocr', start, new Date('2026-02-14T11:59:59.999Z')), true);
  assert.equal(trialAvailable('standard', 'ocr', start, new Date('2026-02-14T12:00:00Z')), false);
  assert.equal(trialAvailable('premium', 'ocr', start, new Date('2028-02-14T12:00:00Z')), true);
  assert.equal(activePlan('premium', 'active', true, new Date('2026-01-31T00:00:00Z'), start), 'free');
});
