const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 50 * 1024 * 1024;
const MIN_LIFETIME = 60_000;
const MAX_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const genericError = 'Link jest nieprawidłowy, wygasł lub został unieważniony.';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const secureEqual = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createShareApp({ dataDir, masterKey, publisherSecret, publicBase, now = Date.now }) {
  if (!/^[a-f0-9]{64}$/i.test(masterKey || '') || typeof publisherSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(publisherSecret)) throw new Error('Brak bezpiecznej konfiguracji usługi.');
  const publicUrl = new URL(publicBase);
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || !['', '/'].includes(publicUrl.pathname)) throw new Error('Adres publiczny musi być adresem HTTPS bez ścieżki.');
  const key = Buffer.from(masterKey, 'hex'); fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const app = express(); app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set({ 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" }); next(); });
  const json = express.json({ limit: '70mb' });
  const file = id => path.join(dataDir, `${id}.json`);
  const read = id => { try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; } };
  const save = (id, value) => { const temp=path.join(dataDir, `${id}.${crypto.randomUUID()}.tmp`); fs.writeFileSync(temp, JSON.stringify(value), { flag:'wx', mode:0o600 }); fs.renameSync(temp, file(id)); };
  const publisher = (req, res, next) => { const candidate = (req.get('authorization') || '').replace(/^Bearer\s+/i, ''); if (!secureEqual(candidate, publisherSecret)) return res.sendStatus(401); next(); };

  app.post('/admin/shares', publisher, json, (req, res) => {
    const { content, mimeType, expiresInSeconds, pin, singleUse } = req.body || {};
    if (typeof content !== 'string' || content.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) return res.status(400).json({ error:'Nieprawidłowy plik.' });
    const bytes = Buffer.from(content, 'base64'); const lifetime = Number(expiresInSeconds) * 1000;
    if (!bytes.length || bytes.length > MAX_BYTES || !['application/pdf','image/jpeg','image/png'].includes(mimeType) || !Number.isSafeInteger(lifetime) || lifetime < MIN_LIFETIME || lifetime > MAX_LIFETIME || (pin !== undefined && !/^\d{6}$/.test(pin)) || (singleUse !== undefined && typeof singleUse !== 'boolean')) return res.status(400).json({ error:'Nieprawidłowe ustawienia linku.' });
    const token=crypto.randomBytes(32).toString('base64url'), id=digest(token), iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(Buffer.from(id)); const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
    const salt=pin ? crypto.randomBytes(16) : null;
    const record={ version:1, expiresAt:now()+lifetime, mimeType, iv:iv.toString('hex'), tag:cipher.getAuthTag().toString('hex'), ciphertext:ciphertext.toString('base64'), salt:salt?.toString('hex') || null, pinHash:pin ? crypto.scryptSync(pin,salt,32).toString('hex') : null, attempts:0, blockedUntil:0, singleUse:Boolean(singleUse) };
    save(id, record);
    res.status(201).json({ id, url:`${publicBase.replace(/\/$/,'')}/s#${token}`, expiresAt:new Date(record.expiresAt).toISOString() });
  });
  app.delete('/admin/shares/:id', publisher, (req,res)=>{ if (!/^[a-f0-9]{64}$/.test(req.params.id)) return res.sendStatus(400); try { fs.unlinkSync(file(req.params.id)); } catch (error) { if (error.code !== 'ENOENT') throw error; } res.status(204).end(); });
  app.get('/s', (_req,res)=>res.type('html').send('<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bezpieczny dokument</title><link rel="stylesheet" href="/share.css"><main><h1>Bezpieczny dokument E‑Teczki</h1><p>Jeżeli nadawca ustawił PIN, wpisz go przed pobraniem.</p><label>PIN (jeśli wymagany)<input id="pin" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><button id="download">Pobierz dokument</button><p id="status" role="status"></p></main><script src="/share.js" defer></script></html>'));
  app.get('/share.css', (_req,res)=>res.type('css').send('body{background:#0f172a;color:#e2e8f0;font:16px sans-serif;padding:24px}main{max-width:32rem;margin:10vh auto;padding:24px;border:1px solid #475569;border-radius:12px}label,input,button{display:block;width:100%;box-sizing:border-box;margin-top:12px;padding:12px}button{background:#2563eb;color:white;border:0;border-radius:6px;font-weight:bold}'));
  app.get('/share.js', (_req,res)=>res.type('application/javascript').send(`document.getElementById('download').addEventListener('click',async()=>{const status=document.getElementById('status');const token=location.hash.slice(1);status.textContent='Pobieranie…';try{const r=await fetch('/public/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,pin:document.getElementById('pin').value})});if(!r.ok){const x=await r.json();throw Error(x.error||'Nie udało się pobrać dokumentu.')}const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=b.type==='application/pdf'?'dokument.pdf':'dokument';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);status.textContent='Dokument pobrany.'}catch(e){status.textContent=e.message}});`));
  app.post('/public/redeem', express.json({limit:'2kb'}), (req,res)=>{
    const { token, pin }=req.body||{}; if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).json({error:genericError});
    const id=digest(token), record=read(id); if(!record || record.expiresAt<=now()) { if(record) try{fs.unlinkSync(file(id));}catch{} return res.status(404).json({error:genericError}); }
    if(record.blockedUntil>now()) return res.status(429).json({error:'Zbyt wiele prób. Spróbuj ponownie później.'});
    if(record.pinHash) {
      const valid=typeof pin==='string' && /^\d{6}$/.test(pin) && secureEqual(crypto.scryptSync(pin,Buffer.from(record.salt,'hex'),32).toString('hex'),record.pinHash);
      if(!valid){record.attempts=(record.attempts||0)+1;if(record.attempts>=5){record.blockedUntil=now()+15*60_000;record.attempts=0;}save(id,record);return res.status(403).json({error:'Nieprawidłowy PIN.'});}
    }
    try { const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'hex'));decipher.setAAD(Buffer.from(id));decipher.setAuthTag(Buffer.from(record.tag,'hex'));const bytes=Buffer.concat([decipher.update(Buffer.from(record.ciphertext,'base64')),decipher.final()]);if(record.singleUse)fs.unlinkSync(file(id));else if(record.attempts||record.blockedUntil){record.attempts=0;record.blockedUntil=0;save(id,record);}res.set('Content-Disposition','attachment; filename="dokument"');return res.type(record.mimeType).send(bytes); } catch { return res.status(500).json({error:'Nie udało się odczytać dokumentu.'}); }
  });
  const cleanup = () => { for (const name of fs.readdirSync(dataDir)) { if (!/^[a-f0-9]{64}\.json$/.test(name)) continue; const id=name.slice(0,64), record=read(id); if (record && Number.isFinite(record.expiresAt) && record.expiresAt <= now()) { try { fs.unlinkSync(file(id)); } catch {} } } };
  cleanup(); const timer=setInterval(cleanup,60*60*1000); timer.unref();
  return app;
}

if (require.main === module) {
  const app=createShareApp({dataDir:process.env.SHARE_DATA_DIR || '/data',masterKey:process.env.SHARE_MASTER_KEY,publisherSecret:process.env.SHARE_PUBLISH_SECRET,publicBase:process.env.SHARE_PUBLIC_BASE});
  app.listen(Number(process.env.PORT || 8080),'0.0.0.0');
}
module.exports={createShareApp};
