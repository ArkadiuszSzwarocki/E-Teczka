'use strict';
const express = require('express');
const path = require('node:path');

// This API is not yet suitable for exposure to the Internet. Distributed rate
// limiting, password recovery, and deployment-specific origin checks remain.
function createHttpApp(accounts, { ledger, catalog, playBilling, entitlements, feedback, shareRouter, rateLimit, accountRateLimit, handoffRateLimit, cloudflareGate, turnstileGate, googleWebClientId = '', turnstileSiteKey = '', appUrl = '' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health/live', (req, res) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ? res.json({ status: 'ok' }) : res.sendStatus(404));
  if (cloudflareGate) app.use(cloudflareGate);
  if (shareRouter) app.use(shareRouter);
  if (rateLimit) app.use(['/register', '/login', '/google', '/google-challenge', '/link-google', '/verify-email', '/resend-verification', '/request-password-reset', '/reset-password'], rateLimit);
  if (handoffRateLimit) app.use('/handoff', handoffRateLimit);
  if (handoffRateLimit) app.use(['/entitlements','/devices','/billing'], handoffRateLimit);
  if (handoffRateLimit) app.use(['/ledger','/admin','/feedback'], handoffRateLimit);
  app.use(['/ledger','/admin','/feedback'],express.json({limit:'4mb'}));
  app.use(express.json({ limit: '20kb' }));
  if (accountRateLimit) app.use(['/register', '/login', '/resend-verification', '/request-password-reset'], accountRateLimit);
  if (turnstileGate) app.use(['/register', '/login', '/resend-verification', '/request-password-reset'], turnstileGate);
  app.get('/public-config', (_req, res) => res.json({ googleWebClientId, turnstileSiteKey, appUrl }));
  app.get('/account', (_req, res) => {
    const turnstileScript = turnstileSiteKey ? ' https://challenges.cloudflare.com/turnstile/v0/api.js' : '';
    const turnstileFrame = turnstileSiteKey ? ' https://challenges.cloudflare.com' : '';
    res.set({ 'Content-Security-Policy': `default-src 'none'; script-src 'self' https://accounts.google.com/gsi/client${turnstileScript}; frame-src https://accounts.google.com/gsi/${turnstileFrame}; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; connect-src 'self' https://accounts.google.com/gsi/; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`, 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' });
    res.type('html').sendFile(path.join(__dirname, 'account.html'));
  });
  app.get('/accountUi.js', (_req, res) => res.sendFile(path.join(__dirname, 'accountUi.js')));
  app.get(['/verify', '/reset'], (_req, res) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' });
    res.type('html').sendFile(path.join(__dirname, 'accountAction.html'));
  });
  app.get('/account.css', (_req, res) => res.type('css').sendFile(path.join(__dirname, 'account.css')));
  app.get('/accountAction.js', (_req, res) => res.sendFile(path.join(__dirname, 'accountAction.js')));
  app.post('/register', async (req, res) => {
    try { await accounts.register(req.body?.email, req.body?.password); return res.status(202).json({ message: 'Jeśli konto można utworzyć, wyślemy wiadomość potwierdzającą.' }); }
    catch (error) { if (error.message === 'INVALID_INPUT') return res.status(400).json({ error: 'Podaj poprawny e-mail i hasło (minimum 8 znaków).' }); console.error('[accounts] Nie udało się wysłać lub utworzyć potwierdzenia.'); return res.status(202).json({ message: 'Jeśli konto można utworzyć, wyślemy wiadomość potwierdzającą.' }); }
  });
  app.post('/verify-email', async (req, res) => {
    try { await accounts.verifyEmail(req.body?.token); return res.json({ message: 'Adres e-mail został potwierdzony. Możesz się zalogować.' }); }
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
  app.post('/google-challenge', async (_req, res) => res.json({ nonce: await accounts.createGoogleChallenge() }));
  app.post('/google', async (req, res) => {
    try { return res.json(await accounts.googleLogin(req.body?.credential, req.body?.nonce)); }
    catch (error) { if (error.message === 'ACCOUNT_LINK_REQUIRED') return res.status(409).json({ code: 'ACCOUNT_LINK_REQUIRED', error: 'Ten adres ma już konto. Zaloguj się dotychczasową metodą.' }); return res.status(401).json({ error: 'Nie udało się zweryfikować konta Google.' }); }
  });
  const bearer = req => (req.get('authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const hasAdminAccess = req => {
    const crypto = require('node:crypto');
    const expected = String(catalog?.adminToken || '');
    const actual = String(req.get('authorization') || '').replace(/^Bearer /, '');
    return expected.length >= 43 && actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  };
  if(catalog){app.get('/catalog',async(_req,res)=>res.json(await catalog.get()));app.put('/admin/catalog',async(req,res)=>{if(!hasAdminAccess(req))return res.sendStatus(403);try{return res.json(await catalog.save(req.body));}catch{return res.status(400).json({error:'Nieprawidłowa konfiguracja planów.'});}});}
  if (feedback) {
    app.post('/feedback', async (req, res) => {
      try { return res.status(201).json(await feedback.create(bearer(req), req.body)); }
      catch (error) {
        const msg = error?.message || '';
        const status = msg === 'SCREENSHOT_TOO_LARGE' ? 413 : ['INVALID_CATEGORY', 'INVALID_TITLE', 'INVALID_DESCRIPTION', 'INVALID_EMAIL', 'INVALID_SCREENSHOT'].includes(msg) ? 400 : 503;
        const text = msg === 'SCREENSHOT_TOO_LARGE' ? 'Zrzut ekranu jest zbyt duży (maks. ok. 2 MB).' : status === 400 ? 'Sprawdź temat, opis oraz załączony zrzut ekranu.' : 'Nie udało się zapisać zgłoszenia.';
        return res.status(status).json({ code: msg, error: text });
      }
    });
    app.get('/admin/feedback', async (req, res) => {
      if (!hasAdminAccess(req)) return res.sendStatus(403);
      try { return res.json({ items: await feedback.list(req.query?.status, req.query?.limit) }); }
      catch { return res.status(503).json({ error: 'Nie udało się pobrać zgłoszeń.' }); }
    });
    app.patch('/admin/feedback/:id', async (req, res) => {
      if (!hasAdminAccess(req)) return res.sendStatus(403);
      try { return res.json(await feedback.updateStatus(req.params.id, req.body?.status)); }
      catch (error) { return res.status(error?.message === 'NOT_FOUND' ? 404 : 400).json({ error: 'Nie udało się zaktualizować statusu zgłoszenia.' }); }
    });
  }
  if(ledger){const fail=(res,error)=>{const codes=['PLAN_LIMIT_REACHED','DEVICE_LIMIT_REACHED','UNAUTHORIZED','DEVICE_REVOKED','INVALID_OPERATION','OPERATION_MISMATCH','INVALID_INVENTORY','INVALID_FEATURE','INVALID_MIGRATION','OFFLINE_POOL_EXHAUSTED'];const code=codes.includes(error.message)?error.message:'LEDGER_UNAVAILABLE';return res.status(['PLAN_LIMIT_REACHED','DEVICE_LIMIT_REACHED'].includes(code)?403:['UNAUTHORIZED','DEVICE_REVOKED'].includes(code)?401:code==='LEDGER_UNAVAILABLE'?503:400).json({code,error:code==='PLAN_LIMIT_REACHED'?'Osiągnięto wspólny limit konta.':'Nie udało się sprawdzić limitów konta.',feature:error.feature,limit:error.limit,resetsAt:error.resetsAt});};
    for(const endpoint of ['reserve','settle','trial','migrate','offline'])app.post('/ledger/'+endpoint,async(req,res)=>{try{return res.json(await ledger[endpoint](bearer(req),req.body));}catch(error){return fail(res,error);}});
    app.post('/ledger/status',async(req,res)=>{try{return res.json(await ledger.status(bearer(req)));}catch(error){return fail(res,error);}});
  }
  if(playBilling)app.post('/billing/google-play/verify',async(req,res)=>{try{return res.json(await playBilling(bearer(req),req.body));}catch(error){return res.status(error.message==='UNAUTHORIZED'?401:error.message==='BILLING_NOT_CONFIGURED'?503:400).json({code:error.message,error:'Nie udało się potwierdzić zakupu. Wymagana jest konfiguracja rozliczeń Google Play na serwerze kont.'});}});
  if(playBilling?.history)app.post('/billing/history',async(req,res)=>{try{return res.json(await playBilling.history(bearer(req)));}catch{return res.status(401).json({error:'Nie można odczytać historii konta.'});}});
  if(entitlements){
    app.get('/entitlements/public-key',(_req,res)=>res.json({publicKey:entitlements.publicKey}));
    const fail=(res,error)=>res.status(['UNAUTHORIZED','DEVICE_REVOKED'].includes(error.message)?401:error.message==='DEVICE_LIMIT_REACHED'?403:400).json({code:error.message,error:error.message==='DEVICE_LIMIT_REACHED'?'Osiągnięto limit zaufanych urządzeń. Usuń poprzednie urządzenie na stronie konta.':'Nie udało się potwierdzić uprawnień konta.'});
    app.post('/entitlements/register',async(req,res)=>{try{return res.json(await entitlements.register(bearer(req),req.body));}catch(error){return fail(res,error);}});
    app.post('/entitlements/refresh',async(req,res)=>{try{return res.json(await entitlements.refresh(bearer(req)));}catch(error){return fail(res,error);}});
    app.get('/devices',async(req,res)=>{try{return res.json(await entitlements.list(bearer(req)));}catch(error){return fail(res,error);}});
    app.post('/devices/revoke',async(req,res)=>{try{await entitlements.revoke(bearer(req),req.body?.deviceId);return res.sendStatus(204);}catch(error){return fail(res,error);}});
  }
  app.post('/handoff/start', async (req, res) => { try { return res.json(await accounts.startHandoff(req.body?.challenge, req.body?.deviceName)); } catch { return res.status(400).json({ error: 'Nieprawidłowe żądanie logowania.' }); } });
  app.post('/handoff/inspect', async (req, res) => { try { return res.json(await accounts.inspectHandoff(req.body?.requestId)); } catch { return res.status(400).json({ error: 'Żądanie logowania wygasło lub jest nieprawidłowe.' }); } });
  app.post('/handoff/approve', async (req, res) => { try { await accounts.approveHandoff(req.body?.requestId, bearer(req)); return res.status(204).end(); } catch (error) { return res.status(error.message === 'UNAUTHORIZED' ? 401 : 400).json({ error: 'Nie udało się zatwierdzić logowania.' }); } });
  app.post('/handoff/claim', async (req, res) => { try { const session = await accounts.claimHandoff(req.body?.requestId, req.body?.verifier); return session ? res.json(session) : res.status(202).json({ status: 'pending' }); } catch { return res.status(400).json({ error: 'Żądanie logowania wygasło lub jest nieprawidłowe.' }); } });
  app.post('/link-google', async (req, res) => {
    try { await accounts.linkGoogle(bearer(req), req.body?.credential, req.body?.nonce); return res.status(204).end(); }
    catch (error) { if (error.message === 'UNAUTHORIZED') return res.status(401).json({ error: 'Sesja wygasła.' }); if (error.message === 'IDENTITY_IN_USE') return res.status(409).json({ error: 'To konto Google jest już połączone z innym kontem.' }); return res.status(401).json({ error: 'Nie udało się zweryfikować konta Google.' }); }
  });
  app.get('/me', async (req, res) => { const user = await accounts.getSession(bearer(req)); return user ? res.json({ id: user.id, email: user.email, name: user.name }) : res.status(401).json({ error: 'Sesja wygasła.' }); });
  app.post('/logout', async (req, res) => { await accounts.logout(bearer(req)); res.status(204).end(); });
  app.post('/delete-account', async (req, res) => {
    try { await accounts.deleteAccount(bearer(req)); return res.status(204).end(); }
    catch { return res.status(401).json({ error: 'Sesja wygasła.' }); }
  });
  app.get('/privacy', (_req, res) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' });
    res.type('html').send('<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Polityka prywatności — E-Teczka</title><link rel="stylesheet" href="/account.css"><main><h1>Polityka prywatności — E‑Teczka</h1><p>Usługa kont E‑Teczki przechowuje adres e-mail, opcjonalną nazwę konta, skrót hasła (scrypt), skróty tokenów sesji i zaufanych urządzeń, plan, potwierdzenia subskrypcji, zaszyfrowane tokeny zakupów, daty okresów próbnych oraz liczniki wykorzystania funkcji w celu logowania i kontroli wspólnych uprawnień konta.</p><p>Dokumenty przechowywane są lokalnie na urządzeniach użytkownika oraz w jego własnych kopiach zapasowych.</p><p>Użytkownik może w każdej chwili trwale usunąć konto z poziomu aplikacji mobilnej lub kontaktując się z administratorem usługi.</p></main></html>');
  });
  return app;
}
module.exports = { createHttpApp };
