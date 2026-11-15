'use strict';
const crypto = require('node:crypto');
const { hash, token, validToken, first, execute, transaction, issueSession } = require('./dbHelpers');

function createMariaHandoffService({ pool, getSession, now = Date.now }) {
  return {
    async startHandoff(challenge, deviceName) {
      if (!validToken(challenge) || typeof deviceName !== 'string' || !deviceName.trim() || deviceName.length > 80) {
        throw new Error('INVALID_INPUT');
      }
      const requestId = token();
      const displayCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const expiresAt = now() + 300000;
      await execute(
        pool,
        'INSERT INTO sign_in_handoffs (id_hash, challenge, device_name, display_code, expires_at) VALUES (?, ?, ?, ?, ?)',
        [hash(requestId), challenge, deviceName.trim(), displayCode, expiresAt]
      );
      return { requestId, displayCode, expiresAt };
    },
    async inspectHandoff(requestId) {
      if (!validToken(requestId)) throw new Error('INVALID_TOKEN');
      const item = await first(
        pool,
        'SELECT device_name AS deviceName, display_code AS displayCode FROM sign_in_handoffs WHERE id_hash = ? AND expires_at > ? AND approved_session_hash IS NULL',
        [hash(requestId), now()]
      );
      if (!item) throw new Error('INVALID_TOKEN');
      return item;
    },
    async approveHandoff(requestId, rawSession) {
      if (!(await getSession(rawSession))) throw new Error('UNAUTHORIZED');
      if (!validToken(requestId)) throw new Error('INVALID_TOKEN');
      const result = await execute(
        pool,
        'UPDATE sign_in_handoffs SET approved_session_hash = ? WHERE id_hash = ? AND expires_at > ? AND approved_session_hash IS NULL',
        [hash(rawSession), hash(requestId), now()]
      );
      if (result.affectedRows !== 1) throw new Error('INVALID_TOKEN');
    },
    async claimHandoff(requestId, verifier) {
      if (!validToken(requestId) || !validToken(verifier)) throw new Error('INVALID_TOKEN');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      return transaction(pool, async db => {
        const item = await first(
          db,
          'SELECT challenge, approved_session_hash FROM sign_in_handoffs WHERE id_hash = ? AND expires_at > ? FOR UPDATE',
          [hash(requestId), now()]
        );
        if (!item || !crypto.timingSafeEqual(Buffer.from(item.challenge), Buffer.from(challenge))) throw new Error('INVALID_TOKEN');
        if (!item.approved_session_hash) return null;
        const account = await first(
          db,
          'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?',
          [item.approved_session_hash, now()]
        );
        if (!account) throw new Error('INVALID_TOKEN');
        await execute(db, 'DELETE FROM sign_in_handoffs WHERE id_hash = ?', [hash(requestId)]);
        return issueSession(db, account, now, 5 * 60000);
      });
    }
  };
}

module.exports = { createMariaHandoffService };
