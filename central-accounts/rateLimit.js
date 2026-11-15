'use strict';
const crypto = require('node:crypto');

// Single SQLite database shared by all local instances. The proxy must not
// forward arbitrary X-Forwarded-For values; Express trust proxy stays disabled.
function createRateLimiter({ db, limit = 20, windowMs = 15 * 60 * 1000, now = Date.now, namespace = 'auth', identity, secret }) {
  db.exec('CREATE TABLE IF NOT EXISTS auth_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  return (req, res, next) => {
    const subject = identity ? identity(req) : String(res.locals?.verifiedClientIp || req.ip || 'unknown');
    const hasher = secret ? crypto.createHmac('sha256', secret) : crypto.createHash('sha256');
    const key = hasher.update(namespace + ':' + subject).digest('hex');
    const current = now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?').run(current);
      db.prepare('INSERT INTO auth_rate_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, current + windowMs);
      const state = db.prepare('SELECT count, expires_at FROM auth_rate_limits WHERE key = ?').get(key);
      db.exec('COMMIT');
      if (state.count > limit) { res.set('Retry-After', String(Math.max(1, Math.ceil((state.expires_at - current) / 1000)))); return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie później.' }); }
      return next();
    } catch { try { db.exec('ROLLBACK'); } catch {} return res.status(503).json({ error: 'Usługa chwilowo niedostępna.' }); }
  };
}
module.exports = { createRateLimiter };
