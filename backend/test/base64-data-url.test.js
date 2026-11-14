const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBase64DataUrl } = require('../services/base64DataUrl.js');

test('a large printer scan validates without exhausting the call stack', () => {
  const scan = `data:image/jpeg;base64,${'A'.repeat(36 * 1024 * 1024)}`;
  const parsed = parseBase64DataUrl(scan);
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.equal(parsed.base64.length, 36 * 1024 * 1024);
});

test('malformed base64 is rejected before a file is written', () => {
  assert.equal(parseBase64DataUrl('data:image/jpeg;base64,AA*A'), null);
  assert.equal(parseBase64DataUrl('data:image/jpeg;base64,AAA'), null);
  assert.equal(parseBase64DataUrl('data:image/jpeg;base64,AAAA=AAA'), null);
  assert.equal(parseBase64DataUrl('data:image/jpeg;base64,'), null);
});
