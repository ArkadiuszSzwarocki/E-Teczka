'use strict';
const { execute } = require('./dbHelpers');

const EXPIRING_TABLES = ['sessions', 'verifications', 'password_resets', 'google_challenges', 'sign_in_handoffs', 'auth_rate_limits'];

async function cleanExpired(pool, now = Date.now) {
  const current = now();
  for (const table of EXPIRING_TABLES) {
    await execute(pool, `DELETE FROM ${table} WHERE expires_at <= ?`, [current]);
  }
}

module.exports = { cleanExpired };
