'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultCatalog } = require('../services/planCatalog');
const centralDefaults = require('../../central-accounts/catalog.defaults.json');

test('backend defaultCatalog matches central-accounts/catalog.defaults.json contract', () => {
  assert.deepStrictEqual(defaultCatalog, centralDefaults);
});
