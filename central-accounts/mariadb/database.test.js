'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readDatabaseConfig } = require('./database');

test('MariaDB connection requires explicit credentials and database', () => {
  assert.throws(() => readDatabaseConfig({}), /Niepełne/);
  const env = { CENTRAL_MARIADB_HOST: '192.168.0.12', CENTRAL_MARIADB_USER: 'mojateczka_app', CENTRAL_MARIADB_PASSWORD: 'example', CENTRAL_MARIADB_DATABASE: 'E-Teczka' };
  const config = readDatabaseConfig(env);
  assert.equal(config.port, 3307);
  assert.equal(config.database, 'E-Teczka');
  assert.equal(config.multipleStatements, false);
  assert.throws(() => readDatabaseConfig({ ...env, CENTRAL_MARIADB_PORT: '99999' }), /Niepełne/);
});
