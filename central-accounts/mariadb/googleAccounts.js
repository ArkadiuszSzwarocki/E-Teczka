'use strict';
const crypto = require('node:crypto');
const { hash, token, validToken, emailKey, emailValid, first, execute, transaction, issueSession } = require('./dbHelpers');

function createMariaGoogleAccounts({ pool, verifyGoogle, getSession, now = Date.now }) {
  async function consumeGoogleChallenge(nonce) {
    if (!validToken(nonce)) throw new Error('INVALID_CHALLENGE');
    const result = await execute(pool, 'DELETE FROM google_challenges WHERE token_hash = ? AND expires_at > ?', [hash(nonce), now()]);
    if (result.affectedRows !== 1) throw new Error('INVALID_CHALLENGE');
  }

  return {
    async createGoogleChallenge() {
      const nonce = token();
      await execute(pool, 'INSERT INTO google_challenges (token_hash, expires_at) VALUES (?, ?)', [hash(nonce), now() + 300000]);
      return nonce;
    },
    async googleLogin(credential, nonce) {
      await consumeGoogleChallenge(nonce);
      const identity = await verifyGoogle(credential, nonce);
      let account = await first(
        pool,
        'SELECT a.* FROM accounts a JOIN identities i ON i.account_id = a.id WHERE i.provider = ? AND i.subject = ?',
        ['google', identity.subject]
      );
      if (!account) {
        const email = emailKey(identity.email);
        if (!emailValid(email)) throw new Error('INVALID_INPUT');
        account = await transaction(pool, async db => {
          const existing = await first(db, 'SELECT * FROM accounts WHERE email = ? FOR UPDATE', [email]);
          if (existing) {
            // Only Gmail is authoritative here. Third-party addresses still require explicit linking.
            if (!email.endsWith('@gmail.com')) throw new Error('ACCOUNT_LINK_REQUIRED');
            if (!existing.verified) {
              // A pre-registration must not leave its unproven password or recovery links usable.
              await execute(db, 'UPDATE accounts SET verified = 1, password_hash = NULL WHERE id = ?', [existing.id]);
              await execute(db, 'DELETE FROM verifications WHERE account_id = ?', [existing.id]);
              await execute(db, 'DELETE FROM password_resets WHERE account_id = ?', [existing.id]);
              await execute(db, 'DELETE FROM sessions WHERE account_id = ?', [existing.id]);
              existing.verified = 1; existing.password_hash = null;
            }
            await execute(db, 'INSERT INTO identities (provider, subject, account_id) VALUES (?, ?, ?)', ['google', identity.subject, existing.id]);
            return existing;
          }
          const result = await execute(
            db,
            'INSERT INTO accounts (public_id, email, name, verified, created_at) VALUES (?, ?, ?, 1, ?)',
            [crypto.randomBytes(16).toString('hex'), email, identity.name || null, now()]
          );
          await execute(db, 'INSERT INTO identities (provider, subject, account_id) VALUES (?, ?, ?)', ['google', identity.subject, result.insertId]);
          return first(db, 'SELECT * FROM accounts WHERE id = ?', [result.insertId]);
        });
      }
      return issueSession(pool, account, now);
    },
    async linkGoogle(raw, credential, nonce) {
      const account = await getSession(raw);
      if (!account) throw new Error('UNAUTHORIZED');
      await consumeGoogleChallenge(nonce);
      const identity = await verifyGoogle(credential, nonce);
      if (!(await getSession(raw))) throw new Error('UNAUTHORIZED');
      const existing = await first(pool, 'SELECT account_id FROM identities WHERE provider = ? AND subject = ?', ['google', identity.subject]);
      if (existing && String(existing.account_id) !== String(account.internal_id)) throw new Error('IDENTITY_IN_USE');
      if (!existing) {
        await execute(pool, 'INSERT INTO identities (provider, subject, account_id) VALUES (?, ?, ?)', ['google', identity.subject, account.internal_id]);
      }
    }
  };
}

module.exports = { createMariaGoogleAccounts };
