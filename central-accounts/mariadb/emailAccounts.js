'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { hash, token, validToken, emailKey, emailValid, first, execute, transaction, issueSession } = require('./dbHelpers');

const scrypt = promisify(crypto.scrypt);
const validPassword = value => typeof value === 'string' && value.length >= 8 && value.length <= 200;

async function passwordHash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(value, salt, 64)).toString('hex')}`;
}

async function passwordMatches(value, stored) {
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored || '')) return false;
  const [salt, expected] = stored.split(':');
  return crypto.timingSafeEqual(await scrypt(value, salt, 64), Buffer.from(expected, 'hex'));
}

function createMariaEmailAccounts({ pool, sendVerification, sendPasswordReset, now = Date.now }) {
  async function sendCode(email, code, table, send) {
    try { await send(email, code); }
    catch (error) { await execute(pool, `DELETE FROM ${table} WHERE token_hash = ?`, [hash(code)]); throw error; }
  }
  return {
    async register(input, password) {
      const email = emailKey(input);
      if (!emailValid(email) || !validPassword(password)) throw new Error('INVALID_INPUT');
      const hashed = await passwordHash(password), code = token();
      try {
        const created = await transaction(pool, async db => {
          const account = await first(db, 'SELECT id, verified FROM accounts WHERE email = ? FOR UPDATE', [email]);
          if (account?.verified) return false;
          const id = account ? account.id : (await execute(db, 'INSERT INTO accounts (public_id,email,password_hash,created_at) VALUES (?,?,?,?)', [crypto.randomBytes(16).toString('hex'), email, hashed, now()])).insertId;
          await execute(db, 'INSERT INTO verifications (token_hash,account_id,expires_at) VALUES (?,?,?)', [hash(code), id, now() + 3600000]);
          return true;
        });
        if (created) await sendCode(email, code, 'verifications', sendVerification);
      } catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; }
    },
    async verifyEmail(code) {
      if (!validToken(code)) throw new Error('INVALID_INPUT');
      await transaction(pool, async db => {
        const row = await first(db, 'SELECT account_id FROM verifications WHERE token_hash = ? AND expires_at > ? FOR UPDATE', [hash(code), now()]);
        if (!row) throw new Error('INVALID_TOKEN');
        await execute(db, 'UPDATE accounts SET verified = 1 WHERE id = ?', [row.account_id]);
        await execute(db, 'DELETE FROM verifications WHERE account_id = ?', [row.account_id]);
      });
    },
    async resendVerification(input) {
      const email = emailKey(input), row = await first(pool, 'SELECT id FROM accounts WHERE email = ? AND verified = 0', [email]);
      if (!row) return;
      const code = token();
      await execute(pool, 'INSERT INTO verifications (token_hash,account_id,expires_at) VALUES (?,?,?)', [hash(code), row.id, now() + 3600000]);
      await sendCode(email, code, 'verifications', sendVerification);
    },
    async requestPasswordReset(input) {
      const email = emailKey(input), row = await first(pool, 'SELECT id FROM accounts WHERE email = ? AND verified = 1', [email]);
      if (!row) return;
      const code = token();
      await execute(pool, 'INSERT INTO password_resets (token_hash,account_id,expires_at) VALUES (?,?,?)', [hash(code), row.id, now() + 3600000]);
      await sendCode(email, code, 'password_resets', sendPasswordReset);
    },
    async resetPassword(code, password) {
      if (!validToken(code) || !validPassword(password)) throw new Error('INVALID_INPUT');
      const hashed = await passwordHash(password);
      await transaction(pool, async db => {
        const row = await first(db, 'SELECT account_id FROM password_resets WHERE token_hash = ? AND expires_at > ? FOR UPDATE', [hash(code), now()]);
        if (!row) throw new Error('INVALID_TOKEN');
        await execute(db, 'UPDATE accounts SET password_hash = ? WHERE id = ? AND verified = 1', [hashed, row.account_id]);
        await execute(db, 'DELETE FROM password_resets WHERE account_id = ?', [row.account_id]);
        await execute(db, 'DELETE FROM sessions WHERE account_id = ?', [row.account_id]);
      });
    },
    async login(input, password) {
      const account = await first(pool, 'SELECT * FROM accounts WHERE email = ?', [emailKey(input)]);
      const candidate = typeof password === 'string' && password.length <= 200 ? password : '';
      const matches = await passwordMatches(candidate, account?.password_hash || '00000000000000000000000000000000:' + '0'.repeat(128));
      if (!account || !account.verified || !matches) throw new Error('INVALID_CREDENTIALS');
      return transaction(pool, async db => {
        const current = await first(db, 'SELECT * FROM accounts WHERE id = ? FOR UPDATE', [account.id]);
        if (!current || !current.verified || current.password_hash !== account.password_hash) throw new Error('INVALID_CREDENTIALS');
        return issueSession(db, current, now);
      });
    },
    async getSession(raw) {
      if (!validToken(raw)) return null;
      return await first(pool, 'SELECT a.id AS internal_id, a.public_id AS id, a.email, a.name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?', [hash(raw), now()]);
    },
    async logout(raw) { if (validToken(raw)) await execute(pool, 'DELETE FROM sessions WHERE token_hash = ?', [hash(raw)]); },
    async deleteAccount(raw) {
      if (!validToken(raw)) throw new Error('UNAUTHORIZED');
      await transaction(pool, async db => {
        const row = await first(db, 'SELECT account_id FROM sessions WHERE token_hash = ? AND expires_at > ? FOR UPDATE', [hash(raw), now()]);
        if (!row) throw new Error('UNAUTHORIZED');
        await execute(db, 'DELETE FROM accounts WHERE id = ?', [row.account_id]);
      });
    }
  };
}

module.exports = { createMariaEmailAccounts };
