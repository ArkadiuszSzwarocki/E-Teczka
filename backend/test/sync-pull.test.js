const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSyncRouter } = require('../routes/sync.js');

test('sync pull watermark is captured before database reads', async () => {
  const readTimes = [];
  const findMany = async () => { readTimes.push(Date.now()); return []; };
  const app = express();
  app.use('/api/sync', createSyncRouter({ folder: { findMany }, document: { findMany } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sync?lastPulledAt=0`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(readTimes.length, 4);
    assert.ok(readTimes.every(time => body.timestamp <= time));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('sync pull overlaps the last watermark to avoid timestamp boundary gaps', async () => {
  const observed = [];
  const findMany = async args => { observed.push(args.where); return []; };
  const app = express();
  app.use('/api/sync', createSyncRouter({ folder: { findMany }, document: { findMany } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sync?lastPulledAt=10000`);
    assert.equal(response.status, 200);
    assert.equal(observed[0].createdAt.gt.getTime(), 9000);
    assert.equal(observed[2].createdAt.gt.getTime(), 9000);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
