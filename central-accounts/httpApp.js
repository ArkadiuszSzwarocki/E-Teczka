'use strict';
const express = require('express');
const path = require('node:path');

// This API is not yet suitable for exposure to the Internet. Distributed rate
// limiting, password recovery, and deployment-specific origin checks remain.
function createHttpApp(accounts, { rateLimit, accountRateLimit, handoffRateLimit, cloudflareGate, googleWebClientId = '' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  if (cloudflareGate) app.use(cloudflareGate);
  if (rateLimit) app.use(['/register', '/login', '/google', '/google-challenge', '/link-google', '/verify-email', '/resend-verification', '/request-password-reset', '/reset-password'], rateLimit);
  if (handoffRateLimit) app.use('/handoff', handoffRateLimit);
  app.use(express.json({ limit: '20kb' }));
  if (accountRateLimit) app.use(['/register', '/login', '/resend-verification', '/request-password-reset'], accountRateLimit);
  app.get('/public-config', (_req, res) => res.json({ googleWebClientId }));
  app.get('/account', (_req, res) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; style-src 'self' https://accounts.google.com/gsi/style; connect-src 'self' https://accounts.google.com/gsi/; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.type('html').sendFile(path.join(__dirname, 'account.html'));
  });
  app.get('/accountUi.js', (_req, res) => res.sendFile(path.join(__dirname, 'accountUi.js')));
  app.get(['/verify', '/reset'], (_req, res) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.type('html').send('<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Konto E-Teczki</title><main><h1>Konto E-Teczki</h1><p id="message">Sprawdzanie linku…</p><form id="form" hidden><label>Nowe hasło (minimum 8 znaków)<input id="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" required></label><button type="submit">Zmień hasło</button></form></main><script src="/accountAction.js" defer></script></html>');
  });
  app.get('/accountAction.js', (_req, res) => res.sendFile(path.join(__dirname, 'accountAction.js')));
  app.post('/register', async (req, res) => {
    try { await accounts.register(req.body?.email, req.body?.password); return res.status(202).json({ message: 'Jeśli konto można utworzyć, wyślemy wiadomość potwierdzającą.' }); }
    catch (error) { if (error.message === 'INVALID_INPUT') return res.status(400).json({ error: 'Podaj poprawny e-mail i hasło (minimum 8 znaków).' }); console.error('[accounts] Nie udało się wysłać lub utworzyć potwierdzenia.'); return res.status(202).json({ message: 'Jeśli konto można utworzyć, wyślemy wiadomość potwierdzającą.' }); }
  });
  app.post('/verify-email', async (req, res) => {
    try { await accounts.verifyEmail(req.body?.token, req.body?.password); return res.json({ message: 'Adres e-mail został potwierdzony. Możesz się zalogować.' }); }
    catch { return res.status(400).json({ error: 'Link potwierdzający jest nieprawidłowy lub wygasł.' }); }
  });
  app.post('/resend-verification', async (req, res) => {
    try { await accounts.resendVerification(req.body?.email); return res.status(202).json({ message: 'Jeśli konto wymaga potwierdzenia, wyślemy wiadomość.' }); }
    catch { console.error('[accounts] Nie udało się wysłać potwierdzenia.'); return res.status(202).json({ message: 'Jeśli konto wymaga potwierdzenia, wyślemy wiadomość.' }); }
  });
  app.post('/request-password-reset', async (req, res) => {
    try { await accounts.requestPasswordReset(req.body?.email); return res.status(202).json({ message: 'Jeśli konto umożliwia reset, wyślemy wiadomość.' }); }
    catch { console.error('[accounts] Nie udało się wysłać wiadomości zmiany hasła.'); return res.status(202).json({ message: 'Jeśli konto umożliwia reset, wyślemy wiadomość.' }); }
  });
  app.post('/reset-password', async (req, res) => {
    try { await accounts.resetPassword(req.body?.token, req.body?.password); return res.json({ message: 'Hasło zostało zmienione. Zaloguj się ponownie.' }); }
    catch { return res.status(400).json({ error: 'Link jest nieprawidłowy lub hasło jest za krótkie.' }); }
  });
  app.post('/login', async (req, res) => {
    try { return res.json(await accounts.login(req.body?.email, req.body?.password)); }
    catch { return res.status(401).json({ error: 'Nieprawidłowe dane lub niepotwierdzony adres e-mail.' }); }
  });
  app.post('/google-challenge', (_req, res) => res.json({ nonce: accounts.createGoogleChallenge() }));
  app.post('/google', async (req, res) => {
    try { return res.json(await accounts.googleLogin(req.body?.credential, req.body?.nonce)); }
    catch (error) { if (error.message === 'ACCOUNT_LINK_REQUIRED') return res.status(409).json({ code: 'ACCOUNT_LINK_REQUIRED', error: 'Ten adres ma już konto. Zaloguj się dotychczasową metodą.' }); return res.status(401).json({ error: 'Nie udało się zweryfikować konta Google.' }); }
  });
  const bearer = req => (req.get('authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  app.post('/handoff/start', (req, res) => { try { return res.json(accounts.startHandoff(req.body?.challenge, req.body?.deviceName)); } catch { return res.status(400).json({ error: 'Nieprawidłowe żądanie logowania.' }); } });
  app.post('/handoff/inspect', (req, res) => { try { return res.json(accounts.inspectHandoff(req.body?.requestId)); } catch { return res.status(400).json({ error: 'Żądanie logowania wygasło lub jest nieprawidłowe.' }); } });
  app.post('/handoff/approve', (req, res) => { try { accounts.approveHandoff(req.body?.requestId, bearer(req)); return res.status(204).end(); } catch (error) { return res.status(error.message === 'UNAUTHORIZED' ? 401 : 400).json({ error: 'Nie udało się zatwierdzić logowania.' }); } });
  app.post('/handoff/claim', (req, res) => { try { const session = accounts.claimHandoff(req.body?.requestId, req.body?.verifier); return session ? res.json(session) : res.status(202).json({ status: 'pending' }); } catch { return res.status(400).json({ error: 'Żądanie logowania wygasło lub jest nieprawidłowe.' }); } });
  app.post('/link-google', async (req, res) => {
    try { await accounts.linkGoogle(bearer(req), req.body?.credential, req.body?.nonce); return res.status(204).end(); }
    catch (error) { if (error.message === 'UNAUTHORIZED') return res.status(401).json({ error: 'Sesja wygasła.' }); if (error.message === 'IDENTITY_IN_USE') return res.status(409).json({ error: 'To konto Google jest już połączone z innym kontem.' }); return res.status(401).json({ error: 'Nie udało się zweryfikować konta Google.' }); }
  });
  app.get('/me', (req, res) => { const user = accounts.getSession(bearer(req)); return user ? res.json({ id: user.id, email: user.email, name: user.name }) : res.status(401).json({ error: 'Sesja wygasła.' }); });
  app.post('/logout', (req, res) => { accounts.logout(bearer(req)); res.status(204).end(); });
  return app;
}
module.exports = { createHttpApp };
