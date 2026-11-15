'use strict';
const crypto = require('node:crypto');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const emailKey = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const emailValid = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function first(db, sql, params = []) {
  const [rows] = await db.execute(sql, params);
  return rows[0] || null;
}

async function execute(db, sql, params = []) {
  const [result] = await db.execute(sql, params);
  return result;
}

async function transaction(pool, fn) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const value = await fn(db);
    await db.commit();
    return value;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

async function issueSession(db, account, now, lifetimeMs = 30 * 86400000) {
  const raw = token();
  const expiresAt = now() + lifetimeMs;
  await execute(db, 'INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)', [hash(raw), account.id, expiresAt]);
  return { token: raw, expiresAt, user: { id: account.public_id, email: account.email, name: account.name } };
}

module.exports = { hash, token, validToken, emailKey, emailValid, first, execute, transaction, issueSession };
