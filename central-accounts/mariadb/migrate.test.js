'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate } = require('./migrate');

test('migration rejects an unexpected database or nonempty database', async () => {
  let calls = 0;
  await assert.rejects(migrate({ query: async () => { calls++; return [[{name: 'other'}]]; } }), /wybrana baza/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(migrate({ query: async () => ++calls === 1 ? [[{name: 'E-Teczka'}]] : [[{name: 'existing'}]] }), /nie jest pusta/);
  assert.equal(calls, 2);
});

test('migration applies only the expected schema to an empty database', async () => {
  const statements = [];
  const count = await migrate({ query: async sql => { statements.push(sql); if (statements.length === 1) return [[{name: 'E-Teczka'}]]; return [[]]; } });
  assert.equal(count, 8);
  assert.equal(statements.length, 10);
  assert.ok(statements.slice(2).every(sql => /CREATE TABLE IF NOT EXISTS/.test(sql)));
});
