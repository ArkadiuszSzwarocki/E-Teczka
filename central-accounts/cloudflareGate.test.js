'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudflareGate } = require('./cloudflareGate');

test('accepts client IP only from the explicitly trusted connector', () => {
  assert.throws(() => createCloudflareGate('not-an-ip'));
  const gate = createCloudflareGate('10.0.3.5'); let calls = 0, denials = 0;
  const res = { locals: {}, status(code) { assert.equal(code, 403); denials++; return this; }, json() { return this; } };
  const next = () => { calls++; };
  const req = (peer, ip) => ({ socket: { remoteAddress: peer }, get: name => name === 'cf-connecting-ip' ? ip : undefined });
  gate(req('10.0.3.6', '203.0.113.9'), res, next);
  gate(req('10.0.3.5', 'forged:not-an-ip'), res, next);
  gate(req('::ffff:10.0.3.5', '203.0.113.9'), res, next);
  assert.equal(denials, 2); assert.equal(calls, 1); assert.equal(res.locals.verifiedClientIp, '203.0.113.9');
});
