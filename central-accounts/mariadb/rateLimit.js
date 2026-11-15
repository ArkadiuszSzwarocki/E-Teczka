'use strict';
const crypto = require('node:crypto');
const { first, execute, transaction } = require('./dbHelpers');

function createMariaRateLimiter({ pool, limit = 20, windowMs = 15 * 60 * 1000, now = Date.now, namespace = 'auth', identity, secret }) {
  return async (req, res, next) => {
    const subject = identity ? identity(req) : String(res.locals?.verifiedClientIp || req.ip || 'unknown');
    const hasher = secret ? crypto.createHmac('sha256', secret) : crypto.createHash('sha256');
    const key = hasher.update(`${namespace}:${subject}`).digest('hex');
    const current = now();
    try {
      const state = await transaction(pool, async db => {
        await execute(db, 'DELETE FROM auth_rate_limits WHERE `key` = ? AND expires_at <= ?', [key, current]);
        await execute(
          db,
          'INSERT INTO auth_rate_limits (`key`, `count`, expires_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE `count` = `count` + 1',
          [key, current + windowMs]
        );
        return first(db, 'SELECT `count`, expires_at FROM auth_rate_limits WHERE `key` = ?', [key]);
      });
      if (state && state.count > limit) {
        res.set('Retry-After', String(Math.max(1, Math.ceil((Number(state.expires_at) - current) / 1000))));
        return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie później.' });
      }
      return next();
    } catch {
      return res.status(503).json({ error: 'Usługa chwilowo niedostępna.' });
    }
  };
}

module.exports = { createMariaRateLimiter };
