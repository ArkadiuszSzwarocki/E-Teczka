import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBase } from '../src/services/apiBase.ts';

test('desktop file URL uses the local HTTP backend', () => {
  assert.equal(resolveApiBase({ protocol: 'file:', hostname: '' }), 'http://127.0.0.1:3000');
});

test('development and LAN URLs resolve to their corresponding backend', () => {
  assert.equal(resolveApiBase({ protocol: 'http:', hostname: 'localhost' }), 'http://localhost:3000');
  assert.equal(resolveApiBase({ protocol: 'http:', hostname: '192.168.0.15' }), 'http://192.168.0.15:3000');
  assert.equal(resolveApiBase({ protocol: 'file:', hostname: '' }, 'https://example.com/api/'), 'https://example.com/api');
});
