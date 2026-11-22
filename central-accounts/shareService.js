'use strict';
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

const MAX_BYTES = 50 * 1024 * 1024;
const MIN_LIFETIME = 60_000;
const MAX_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const GENERIC_ERROR = 'Link jest nieprawidłowy, wygasł lub został unieważniony.';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const secureEqual = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function createShareRouter({ dataDir, masterKey, publisherSecret, publicBase, now = Date.now }) {
  if (!/^[a-f0-9]{64}$/i.test(masterKey || '') || typeof publisherSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(publisherSecret)) {
    throw new Error('Brak bezpiecznej konfiguracji usługi linków.');
  }
  const publicUrl = new URL(publicBase);
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || !['', '/'].includes(publicUrl.pathname)) {
    throw new Error('Adres publiczny usługi linków musi być adresem HTTPS bez ścieżki.');
  }

  const key = Buffer.from(masterKey, 'hex');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const router = express.Router();
  const largeJson = express.json({ limit: '70mb' });
  const file = id => path.join(dataDir, `${id}.json`);
  const read = id => { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; } };
  const save = (id, value) => {
    const temp = path.join(dataDir, `${id}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file(id));
  };
  const publisher = (req, res, next) => {
    const candidate = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!secureEqual(candidate, publisherSecret)) return res.sendStatus(401);
    next();
  };
  const shareSecurityHeaders = (_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
    });
    next();
  };

  router.post('/admin/shares', publisher, largeJson, async (req, res) => {
    const { content, mimeType, expiresInSeconds, pin, singleUse } = req.body || {};
    if (typeof content !== 'string' || content.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
      return res.status(400).json({ error: 'Nieprawidłowy plik.' });
    }
    const bytes = Buffer.from(content, 'base64');
    const lifetime = Number(expiresInSeconds) * 1000;
    if (!bytes.length || bytes.length > MAX_BYTES || !['application/pdf', 'image/jpeg', 'image/png'].includes(mimeType) || !Number.isSafeInteger(lifetime) || lifetime < MIN_LIFETIME || lifetime > MAX_LIFETIME || (pin !== undefined && !/^\d{6}$/.test(pin)) || (singleUse !== undefined && typeof singleUse !== 'boolean')) {
      return res.status(400).json({ error: 'Nieprawidłowe ustawienia linku.' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const id = digest(token);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const salt = pin ? crypto.randomBytes(16) : null;
    const pinHash = pin ? (await scryptAsync(pin, salt, 32)).toString('hex') : null;
    const record = {
      version: 1,
      expiresAt: now() + lifetime,
      mimeType,
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('base64'),
      salt: salt?.toString('hex') || null,
      pinHash,
      attempts: 0,
      blockedUntil: 0,
      singleUse: Boolean(singleUse)
    };
    save(id, record);
    res.status(201).json({ id, url: `${publicBase.replace(/\/$/, '')}/s#${token}`, expiresAt: new Date(record.expiresAt).toISOString() });
  });

  router.delete('/admin/shares/:id', publisher, (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) return res.sendStatus(400);
    try { fs.unlinkSync(file(req.params.id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    res.status(204).end();
  });

  router.get('/s', shareSecurityHeaders, (_req, res) => res.type('html').send(
    '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bezpieczny dokument — MojaTeczka</title><link rel="stylesheet" href="/share.css"></head>' +
    '<body><main class="shell"><header class="brand">Moja<span>Teczka</span> <small>Twoje archiwum</small></header>' +
    '<div class="grid">' +
    '<section class="promo">' +
    '<p class="eyebrow">Mniej papieru. Więcej porządku.</p>' +
    '<h1>Wszystkie dokumenty.<br><span>Jedno miejsce.</span></h1>' +
    '<p class="lead">Bezpiecznie odbierz udostępniony plik, a własne dokumenty uporządkuj w aplikacji MojaTeczka na komputer i telefon.</p>' +
    '<div class="steps">' +
    '<div class="step"><span>01</span><div><h2>Szyfrowane archiwum na komputerze</h2><p>Pełna kontrola nad plikami, wyszukiwanie OCR i automatyczne kopie na NAS.</p></div></div>' +
    '<div class="step"><span>02</span><div><h2>Aplikacja na telefon i skaner</h2><p>Skanuj dokumenty aparatem lub drukarką prosto do swoich kartotek.</p></div></div>' +
    '<div class="step"><span>03</span><div><h2>Powiadomienia o terminach</h2><p>Pilnuj ważności polis, umów, gwarancji i przeglądów w jednym miejscu.</p></div></div>' +
    '<div class="step"><span>04</span><div><h2>Bezpieczne linki z PIN‑em</h2><p>Udostępniaj pliki jednorazowo lub z datą wygaśnięcia — tak jak ten dokument.</p></div></div>' +
    '</div>' +
    '<div class="cta"><p class="cta-title">Chcesz wygodnie archiwizować własne dokumenty?</p><p class="cta-sub">Pobierz aplikację MojaTeczka na Windows i Android i załóż bezpłatne konto.</p><a class="cta-btn" href="/account">Załóż konto i poznaj MojąTeczkę →</a></div>' +
    '</section>' +
    '<section class="card" aria-labelledby="share-title">' +
    '<span class="badge">Zaszyfrowane udostępnianie</span>' +
    '<h2 id="share-title">Bezpieczny dokument MojejTeczki</h2>' +
    '<p class="card-desc">Jeżeli nadawca zabezpieczył plik kodem PIN, wpisz 6 cyfr poniżej przed pobraniem.</p>' +
    '<label for="pin">PIN (jeśli wymagany)</label>' +
    '<input id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••">' +
    '<button id="download" type="button">Pobierz dokument</button>' +
    '<p id="status" role="status"></p>' +
    '</section>' +
    '</div>' +
    '<footer class="foot">MojaTeczka · Twoje cyfrowe archiwum dokumentów</footer>' +
    '</main><script src="/share.js" defer></script></body></html>'
  ));
  router.get('/share.css', shareSecurityHeaders, (_req, res) => res.type('css').send(
    '*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0b1120;color:#e2e8f0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    '.shell{max-width:72rem;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;padding:24px}' +
    '.brand{font-size:1.25rem;font-weight:700;color:#fff;letter-spacing:-0.02em}.brand span{color:#60a5fa}.brand small{margin-left:10px;font-size:0.7rem;font-weight:400;text-transform:uppercase;letter-spacing:0.14em;color:#64748b}' +
    '.grid{flex:1;display:grid;gap:40px;align-items:center;padding:28px 0;grid-template-columns:1fr}@media(min-width:960px){.grid{grid-template-columns:1.1fr 0.9fr;gap:48px}}' +
    '.eyebrow{margin:0 0 14px;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.22em;color:#60a5fa}' +
    '.promo h1{margin:0;font-size:clamp(2rem,4vw,3.3rem);line-height:1.12;font-weight:700;color:#fff}.promo h1 span{color:#60a5fa}' +
    '.lead{margin:18px 0 0;max-width:30rem;color:#94a3b8;font-size:1.05rem}' +
    '.steps{margin:24px 0 0;display:grid;gap:14px}.step{display:flex;gap:14px;align-items:flex-start}' +
    '.step span{flex:0 0 36px;height:36px;display:flex;align-items:center;justify-content:center;border:1px solid #334155;border-radius:10px;font-size:0.75rem;font-weight:600;color:#93c5fd}' +
    '.step h2{margin:0;font-size:0.95rem;font-weight:600;color:#e2e8f0}.step p{margin:3px 0 0;font-size:0.85rem;color:#64748b}' +
    '.cta{margin-top:24px;padding:18px;border:1px solid rgba(59,130,246,0.35);background:rgba(30,58,138,0.2);border-radius:16px}' +
    '.cta-title{margin:0;font-weight:700;color:#fff;font-size:0.95rem}.cta-sub{margin:4px 0 12px;font-size:0.85rem;color:#cbd5e1}' +
    '.cta-btn{display:inline-block;padding:10px 16px;border-radius:10px;background:#1e293b;border:1px solid #475569;color:#93c5fd;text-decoration:none;font-size:0.85rem;font-weight:600}.cta-btn:hover{background:#334155;color:#fff}' +
    '.card{background:#0f172a;border:1px solid #334155;border-radius:24px;padding:28px;box-shadow:0 24px 50px rgba(0,0,0,0.45)}' +
    '.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.4);color:#6ee7b7;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em}' +
    '.card h2{margin:14px 0 6px;font-size:1.5rem;color:#fff}.card-desc{margin:0 0 20px;font-size:0.9rem;color:#94a3b8}' +
    'label{display:block;font-size:0.85rem;color:#cbd5e1;font-weight:500}' +
    'input{display:block;width:100%;margin-top:8px;padding:12px 14px;border-radius:12px;border:1px solid #475569;background:#020617;color:#fff;font-size:1rem;letter-spacing:0.15em;outline:none}input:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,0.2)}' +
    'button{display:block;width:100%;margin-top:16px;padding:13px;border:0;border-radius:12px;background:#2563eb;color:#fff;font-size:1rem;font-weight:700;cursor:pointer}button:hover{background:#3b82f6}button:disabled{opacity:0.6;cursor:wait}' +
    '#status{margin:14px 0 0;min-height:1.25rem;font-size:0.9rem;color:#cbd5e1}#status.ok{color:#6ee7b7}#status.err{color:#fca5a5}' +
    '.foot{font-size:0.75rem;color:#475569;padding-top:12px}'
  ));
  router.get('/share.js', shareSecurityHeaders, (_req, res) => res.type('application/javascript').send(`document.getElementById('download').addEventListener('click',async()=>{const btn=document.getElementById('download'),status=document.getElementById('status'),token=location.hash.slice(1);status.className='';status.textContent='Pobieranie i odszyfrowywanie…';btn.disabled=true;try{const r=await fetch('/public/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,pin:document.getElementById('pin').value})});if(!r.ok){const x=await r.json();throw Error(x.error||'Nie udało się pobrać dokumentu.')}const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=b.type==='application/pdf'?'dokument.pdf':'dokument';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);status.className='ok';status.textContent='Dokument został pobrany.';}catch(e){status.className='err';status.textContent=e.message;}finally{btn.disabled=false;}});`));

  router.post('/public/redeem', shareSecurityHeaders, express.json({ limit: '2kb' }), async (req, res) => {
    const { token, pin } = req.body || {};
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).json({ error: GENERIC_ERROR });
    const id = digest(token);
    const record = read(id);
    if (!record || record.expiresAt <= now()) {
      if (record) try { fs.unlinkSync(file(id)); } catch {}
      return res.status(404).json({ error: GENERIC_ERROR });
    }
    if (record.blockedUntil > now()) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie później.' });
    if (record.pinHash) {
      const valid = typeof pin === 'string' && /^\d{6}$/.test(pin) && secureEqual((await scryptAsync(pin, Buffer.from(record.salt, 'hex'), 32)).toString('hex'), record.pinHash);
      if (!valid) {
        record.attempts = (record.attempts || 0) + 1;
        if (record.attempts >= 5) { record.blockedUntil = now() + 15 * 60_000; record.attempts = 0; }
        save(id, record);
        return res.status(403).json({ error: 'Nieprawidłowy PIN.' });
      }
    }
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'hex'), { authTagLength: 16 });
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]);
      if (record.singleUse) fs.unlinkSync(file(id));
      else if (record.attempts || record.blockedUntil) { record.attempts = 0; record.blockedUntil = 0; save(id, record); }
      res.set('Content-Disposition', 'attachment; filename="dokument"');
      return res.type(record.mimeType).send(bytes);
    } catch {
      return res.status(500).json({ error: 'Nie udało się odczytać dokumentu.' });
    }
  });

  const cleanup = () => {
    for (const name of fs.readdirSync(dataDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const id = name.slice(0, 64);
      const record = read(id);
      if (record && Number.isFinite(record.expiresAt) && record.expiresAt <= now()) {
        try { fs.unlinkSync(file(id)); } catch {}
      }
    }
  };
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000).unref();
  return router;
}

module.exports = { createShareRouter };
