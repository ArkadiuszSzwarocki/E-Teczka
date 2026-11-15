'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const emailKey = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
const emailValid = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function createAccountService({ db, sendVerification, sendPasswordReset = async () => { throw new Error('Reset email not configured'); }, verifyGoogle, now = Date.now }) {
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, password_hash TEXT, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts(id), PRIMARY KEY(provider, subject));
    CREATE TABLE IF NOT EXISTS verifications (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS google_challenges (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sign_in_handoffs (id_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, device_name TEXT NOT NULL, display_code TEXT NOT NULL, approved_session_hash TEXT, expires_at INTEGER NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'public_id')) {
    db.exec('ALTER TABLE accounts ADD COLUMN public_id TEXT');
  }
  db.exec('UPDATE accounts SET public_id = lower(hex(randomblob(16))) WHERE public_id IS NULL');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS account_public_id ON accounts(public_id)');
  async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = await scrypt(password, salt, 64);
    return salt + ':' + hash.toString('hex');
  }
  async function passwordMatches(password, stored) {
    if (!stored || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
    const [salt, expected] = stored.split(':');
    const actual = await scrypt(password, salt, 64);
    return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  }
  function issueSession(account, lifetimeMs = 30 * 86400000) {
    const raw = token(); const expiresAt = now() + lifetimeMs;
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(raw), account.id, expiresAt);
    return { token: raw, expiresAt, user: { id: account.public_id, email: account.email, name: account.name } };
  }
  function consumeGoogleChallenge(nonce) {
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error('INVALID_CHALLENGE');
    const result = db.prepare('DELETE FROM google_challenges WHERE token_hash = ? AND expires_at > ?').run(digest(nonce), now());
    if (Number(result.changes) !== 1) throw new Error('INVALID_CHALLENGE');
  }
  return {
    createGoogleChallenge() {
      const nonce = token(); db.prepare('INSERT INTO google_challenges VALUES (?, ?)').run(digest(nonce), now() + 300000);
      return nonce;
    },
    startHandoff(challenge, deviceName) {
      if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 80) throw new Error('INVALID_INPUT');
      const requestId = token(), displayCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expiresAt = now() + 300000;
      db.prepare('INSERT INTO sign_in_handoffs(id_hash,challenge,device_name,display_code,expires_at) VALUES (?,?,?,?,?)').run(digest(requestId), challenge, deviceName.trim(), displayCode, expiresAt);
      return { requestId, displayCode, expiresAt };
    },
    inspectHandoff(requestId) {
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(requestId)) throw new Error('INVALID_TOKEN');
      const item = db.prepare('SELECT device_name AS deviceName, display_code AS displayCode FROM sign_in_handoffs WHERE id_hash = ? AND expires_at > ? AND approved_session_hash IS NULL').get(digest(requestId), now());
      if (!item) throw new Error('INVALID_TOKEN');
      return item;
    },
    approveHandoff(requestId, rawSession) {
      if (!this.getSession(rawSession)) throw new Error('UNAUTHORIZED');
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(requestId)) throw new Error('INVALID_TOKEN');
      const result = db.prepare('UPDATE sign_in_handoffs SET approved_session_hash = ? WHERE id_hash = ? AND expires_at > ? AND approved_session_hash IS NULL').run(digest(rawSession), digest(requestId), now());
      if (Number(result.changes) !== 1) throw new Error('INVALID_TOKEN');
    },
    claimHandoff(requestId, verifier) {
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(requestId) || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier)) throw new Error('INVALID_TOKEN');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      db.exec('BEGIN IMMEDIATE');
      try {
        const item = db.prepare('SELECT challenge, approved_session_hash FROM sign_in_handoffs WHERE id_hash = ? AND expires_at > ?').get(digest(requestId), now());
        if (!item || !crypto.timingSafeEqual(Buffer.from(item.challenge), Buffer.from(challenge))) throw new Error('INVALID_TOKEN');
        if (!item.approved_session_hash) { db.exec('COMMIT'); return null; }
        const account = db.prepare('SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?').get(item.approved_session_hash, now());
        if (!account) throw new Error('INVALID_TOKEN');
        db.prepare('DELETE FROM sign_in_handoffs WHERE id_hash = ?').run(digest(requestId));
        const session = issueSession(account, 5 * 60000); db.exec('COMMIT'); return session;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async register(email, password) {
      email = emailKey(email);
      if (!emailValid(email) || typeof password !== 'string' || password.length < 8 || password.length > 200) throw new Error('INVALID_INPUT');
      const hashed = await hashPassword(password);
      const existing = db.prepare('SELECT id, verified FROM accounts WHERE email = ?').get(email);
      if (existing) { if (!existing.verified) await this.resendVerification(email); return; }
      const code = token(); let id;
      db.exec('BEGIN IMMEDIATE');
      try {
        id = Number(db.prepare('INSERT INTO accounts(email, password_hash, created_at, public_id) VALUES (?, ?, ?, ?)').run(email, hashed, now(), crypto.randomBytes(16).toString('hex')).lastInsertRowid);
        db.prepare('INSERT INTO verifications VALUES (?, ?, ?)').run(digest(code), id, now() + 3600000);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); if (db.prepare('SELECT id FROM accounts WHERE email = ?').get(email)) return; throw error; }
      try { await sendVerification(email, code); } catch (error) {
        db.exec('BEGIN IMMEDIATE');
        try { db.prepare('DELETE FROM verifications WHERE account_id = ?').run(id); db.prepare('DELETE FROM accounts WHERE id = ? AND verified = 0').run(id); db.exec('COMMIT'); }
        catch { db.exec('ROLLBACK'); }
        throw error;
      }
    },
    async verifyEmail(code, password) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('INVALID_TOKEN');
      if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new Error('INVALID_INPUT');
      const hashed = await hashPassword(password);
      db.exec('BEGIN IMMEDIATE');
      try {
        const item = db.prepare('SELECT account_id FROM verifications WHERE token_hash = ? AND expires_at > ?').get(digest(code), now());
        if (!item) throw new Error('INVALID_TOKEN');
        db.prepare('UPDATE accounts SET verified = 1, password_hash = ? WHERE id = ?').run(hashed, item.account_id);
        db.prepare('DELETE FROM verifications WHERE account_id = ?').run(item.account_id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async resendVerification(email) {
      email = emailKey(email);
      const account = db.prepare('SELECT id FROM accounts WHERE email = ? AND verified = 0').get(email);
      if (!account) return;
      const code = token();
      db.prepare('INSERT INTO verifications VALUES (?, ?, ?)').run(digest(code), account.id, now() + 3600000);
      try { await sendVerification(email, code); }
      catch (error) { db.prepare('DELETE FROM verifications WHERE token_hash = ?').run(digest(code)); throw error; }
    },
    async requestPasswordReset(email) {
      email = emailKey(email);
      const account = db.prepare('SELECT id FROM accounts WHERE email = ? AND verified = 1 AND password_hash IS NOT NULL').get(email);
      if (!account) return;
      const code = token();
      db.prepare('INSERT INTO password_resets VALUES (?, ?, ?)').run(digest(code), account.id, now() + 3600000);
      try { await sendPasswordReset(email, code); }
      catch (error) { db.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(digest(code)); throw error; }
    },
    async resetPassword(code, password) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code) || typeof password !== 'string' || password.length < 8 || password.length > 200) throw new Error('INVALID_INPUT');
      const hashed = await hashPassword(password);
      db.exec('BEGIN IMMEDIATE');
      try {
        const item = db.prepare('SELECT account_id FROM password_resets WHERE token_hash = ? AND expires_at > ?').get(digest(code), now());
        if (!item) throw new Error('INVALID_TOKEN');
        db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ? AND verified = 1').run(hashed, item.account_id);
        db.prepare('DELETE FROM password_resets WHERE account_id = ?').run(item.account_id);
        db.prepare('DELETE FROM sessions WHERE account_id = ?').run(item.account_id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async login(email, password) {
      const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(emailKey(email));
      const candidate = typeof password === 'string' && password.length <= 200 ? password : '';
      const fallback = '00000000000000000000000000000000:' + '0'.repeat(128);
      const matches = await passwordMatches(candidate, account?.password_hash || fallback);
      if (!account || !account.verified || !matches) throw new Error('INVALID_CREDENTIALS');
      const current = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
      if (!current || !current.verified || current.password_hash !== account.password_hash) throw new Error('INVALID_CREDENTIALS');
      return issueSession(current);
    },
    async googleLogin(credential, nonce) {
      consumeGoogleChallenge(nonce);
      const identity = await verifyGoogle(credential, nonce);
      let account = db.prepare('SELECT a.* FROM accounts a JOIN identities i ON i.account_id = a.id WHERE i.provider = ? AND i.subject = ?').get('google', identity.subject);
      if (!account) {
        const email = emailKey(identity.email);
        if (!emailValid(email)) throw new Error('INVALID_INPUT');
        if (db.prepare('SELECT id FROM accounts WHERE email = ?').get(email)) throw new Error('ACCOUNT_LINK_REQUIRED');
        db.exec('BEGIN IMMEDIATE');
        try {
          const id = Number(db.prepare('INSERT INTO accounts(email, name, verified, created_at, public_id) VALUES (?, ?, 1, ?, ?)').run(email, identity.name, now(), crypto.randomBytes(16).toString('hex')).lastInsertRowid);
          db.prepare('INSERT INTO identities VALUES (?, ?, ?)').run('google', identity.subject, id);
          db.exec('COMMIT');
          account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      return issueSession(account);
    },
    async linkGoogle(raw, credential, nonce) {
      const account = this.getSession(raw);
      if (!account) throw new Error('UNAUTHORIZED');
      consumeGoogleChallenge(nonce);
      const identity = await verifyGoogle(credential, nonce);
      if (!this.getSession(raw)) throw new Error('UNAUTHORIZED');
      const existing = db.prepare('SELECT account_id FROM identities WHERE provider = ? AND subject = ?').get('google', identity.subject);
      if (existing && existing.account_id !== account.internal_id) throw new Error('IDENTITY_IN_USE');
      if (!existing) db.prepare('INSERT INTO identities VALUES (?, ?, ?)').run('google', identity.subject, account.internal_id);
    },
    getSession(raw) {
      if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
      const account = db.prepare('SELECT a.id AS internal_id, a.public_id AS id, a.email, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?').get(digest(raw), now());
      return account || null;
    },
    logout(raw) { if (typeof raw === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw)) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(raw)); },
    cleanExpired() {
      const current = now();
      for (const table of ['sessions', 'verifications', 'password_resets', 'google_challenges', 'sign_in_handoffs']) db.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).run(current);
    }
  };
}
module.exports = { createAccountService };
