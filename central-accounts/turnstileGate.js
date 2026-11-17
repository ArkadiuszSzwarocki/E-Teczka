'use strict';

async function defaultVerify(secretKey, token, remoteip) {
  const body = new URLSearchParams({ secret: secretKey, response: token });
  if (remoteip) body.set('remoteip', remoteip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) return false;
  const payload = await response.json().catch(() => null);
  return Boolean(payload?.success);
}

function createTurnstileGate({ secretKey = '', verifyFn = defaultVerify } = {}) {
  if (!secretKey) return (_req, _res, next) => next();
  return async (req, res, next) => {
    const token = req.body?.turnstileToken;
    if (typeof token !== 'string' || !token.trim() || token.length > 4096) {
      return res.status(400).json({ error: 'Wymagane potwierdzenie zabezpieczenia (Turnstile).' });
    }
    try {
      const ok = await verifyFn(secretKey, token.trim(), String(res.locals?.verifiedClientIp || req.ip || ''));
      if (!ok) return res.status(403).json({ error: 'Weryfikacja antybotowa nie powiodła się. Spróbuj ponownie.' });
      return next();
    } catch {
      return res.status(503).json({ error: 'Usługa weryfikacji antybotowej jest chwilowo niedostępna.' });
    }
  };
}

module.exports = { createTurnstileGate };
