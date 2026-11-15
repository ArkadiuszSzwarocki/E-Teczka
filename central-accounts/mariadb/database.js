'use strict';
const mysql = require('mysql2/promise');

function readDatabaseConfig(env = process.env) {
  const host = env.CENTRAL_MARIADB_HOST;
  const user = env.CENTRAL_MARIADB_USER;
  const password = env.CENTRAL_MARIADB_PASSWORD;
  const database = env.CENTRAL_MARIADB_DATABASE;
  const port = Number(env.CENTRAL_MARIADB_PORT || 3307);
  if (!host || !user || !password || !database || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Niepełne ustawienia połączenia z MariaDB.');
  }
  return { host, user, password, database, port, connectTimeout: 30000, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, charset: 'utf8mb4' };
}

function createDatabasePool(env = process.env) {
  return mysql.createPool({ ...readDatabaseConfig(env), waitForConnections: true, connectionLimit: 5, queueLimit: 50 });
}

module.exports = { createDatabasePool, readDatabaseConfig };
