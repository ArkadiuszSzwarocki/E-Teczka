'use strict';

const { OAuth2Client } = require('google-auth-library');

// Caller must obtain an ID token over HTTPS and must not automatically link
// existing email accounts: Google is not authoritative for every email domain.
function createGoogleIdentityVerifier({ audiences, client = new OAuth2Client() }) {
  if (!Array.isArray(audiences) || !audiences.length || audiences.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error('Configure at least one Google OAuth client ID.');
  }
  const allowed = [...new Set(audiences.map(x => x.trim()))];
  return async function verifyGoogleIdentity(token, expectedNonce) {
    if (typeof token !== 'string' || token.length < 1 || token.length > 16384) throw new Error('Invalid Google credential.');
    if (typeof expectedNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(expectedNonce)) throw new Error('Invalid Google challenge.');
    const ticket = await client.verifyIdToken({ idToken: token, audience: allowed });
    const payload = ticket.getPayload();
    if (!payload || payload.nonce !== expectedNonce || typeof payload.sub !== 'string' || !payload.sub || payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email) {
      throw new Error('Google account email is not verified.');
    }
    return { provider: 'google', subject: payload.sub, email: payload.email, name: typeof payload.name === 'string' ? payload.name : null };
  };
}

module.exports = { createGoogleIdentityVerifier };
