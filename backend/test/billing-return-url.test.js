const test = require('node:test');
const assert = require('node:assert/strict');
const { billingReturnBase } = require('../services/billingReturnUrl.js');

test('billing returns to the reachable local server', () => {
  assert.equal(billingReturnBase('127.0.0.1'), 'http://127.0.0.1:3000');
  assert.equal(billingReturnBase('::ffff:127.0.0.1'), 'http://127.0.0.1:3000');
  assert.equal(billingReturnBase('192.168.0.15'), 'http://192.168.0.15:3000');
  assert.equal(billingReturnBase('172.20.192.1'), 'http://172.20.192.1:3000');
  assert.equal(billingReturnBase('203.0.113.5'), 'http://127.0.0.1:3000');
});
