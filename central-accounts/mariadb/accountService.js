'use strict';
const { createMariaEmailAccounts } = require('./emailAccounts');
const { createMariaGoogleAccounts } = require('./googleAccounts');
const { createMariaHandoffService } = require('./handoffService');
const { cleanExpired } = require('./maintenance');

function createMariaAccountService({ pool, sendVerification, sendPasswordReset, verifyGoogle, now = Date.now }) {
  const emailAccounts = createMariaEmailAccounts({ pool, sendVerification, sendPasswordReset, now });
  const googleAccounts = createMariaGoogleAccounts({ pool, verifyGoogle, getSession: emailAccounts.getSession, now });
  const handoffs = createMariaHandoffService({ pool, getSession: emailAccounts.getSession, now });

  return {
    ...emailAccounts,
    ...googleAccounts,
    ...handoffs,
    cleanExpired: () => cleanExpired(pool, now)
  };
}

module.exports = { createMariaAccountService };
