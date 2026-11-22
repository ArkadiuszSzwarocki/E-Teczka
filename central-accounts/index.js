'use strict';
const crypto = require('node:crypto');
const {ensureEntitlementsSchema,createEntitlements}=require('./mariadb/entitlements');
const {createPlayBilling,ensureBillingSchema}=require('./mariadb/playBilling');
const {ensureCatalogSchema,getCatalog,saveCatalog}=require('./mariadb/planCatalog');
const {ensureLedgerSchema,createCentralLedger}=require('./mariadb/planLedger');
const {ensureFeedbackSchema,createFeedbackService}=require('./mariadb/feedbackService');
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}
const { createDatabasePool } = require('./mariadb/database');
const { createMariaAccountService } = require('./mariadb/accountService');
const { createMariaRateLimiter } = require('./mariadb/rateLimit');
const { createGoogleIdentityVerifier } = require('./googleIdentity');
const { createHttpApp } = require('./httpApp');
const { createProxyGate } = require('./proxyGate');
const { createCloudflareGate } = require('./cloudflareGate');
const { createTurnstileGate } = require('./turnstileGate');
const { createShareRouter } = require('./shareService');
const { resolveDesktopDownloadConfig, buildDesktopDownloadEmail } = require('./desktopDownload');

// Direct development access is loopback-only. Container access requires an
// explicitly trusted HTTPS-terminating proxy and a persistent rate-limit key.
const { CENTRAL_GOOGLE_CLIENT_IDS, CENTRAL_SMTP_HOST, CENTRAL_SMTP_USER, CENTRAL_SMTP_PASSWORD, CENTRAL_SMTP_FROM, CENTRAL_VERIFY_URL } = process.env;
if (!CENTRAL_SMTP_HOST || !CENTRAL_SMTP_USER || !CENTRAL_SMTP_PASSWORD || !CENTRAL_SMTP_FROM || !CENTRAL_VERIFY_URL) throw new Error('Central account service configuration is incomplete.');
const verificationUrl = new URL(CENTRAL_VERIFY_URL);
if (!(verificationUrl.protocol === 'https:' || (verificationUrl.protocol === 'http:' && verificationUrl.hostname === '127.0.0.1')) || verificationUrl.username || verificationUrl.password || verificationUrl.hash || verificationUrl.search || verificationUrl.pathname !== '/verify') throw new Error('Verification URL must be HTTPS and point to /verify.');

const smtpPort = Number(process.env.CENTRAL_SMTP_PORT || 465);
const transport = nodemailer.createTransport({ host: CENTRAL_SMTP_HOST, port: smtpPort, secure: smtpPort === 465, auth: { user: CENTRAL_SMTP_USER, pass: CENTRAL_SMTP_PASSWORD } });
const pool = createDatabasePool();
const googleWebClientId = process.env.CENTRAL_GOOGLE_WEB_CLIENT_ID || '';
const googleClients = (CENTRAL_GOOGLE_CLIENT_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
if (googleWebClientId && !googleClients.includes(googleWebClientId)) throw new Error('Google web client ID must be an allowed audience.');

const accounts = createMariaAccountService({
  pool,
  verifyGoogle: googleClients.length ? createGoogleIdentityVerifier({ audiences: googleClients }) : async () => { throw new Error('Google login is not configured.'); },
  sendVerification: async (email, code) => {
    const link = new URL(verificationUrl); link.hash = code;
    await transport.sendMail({ from: CENTRAL_SMTP_FROM, to: email, subject: 'Potwierdzenie konta MojejTeczki', text: `Aby potwierdzić adres e-mail, otwórz: ${link.href}\nLink wygasa po godzinie.` });
  },
  sendPasswordReset: async (email, code) => {
    const link = new URL('/reset', verificationUrl.origin); link.hash = code;
    await transport.sendMail({ from: CENTRAL_SMTP_FROM, to: email, subject: 'Zmiana hasła MojejTeczki', text: `Aby zmienić hasło, otwórz: ${link.href}\nLink wygasa po godzinie. Jeśli nie prosiłeś o zmianę, zignoruj wiadomość.` });
  }
});

const port = Number(process.env.CENTRAL_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const listenHost = process.env.CENTRAL_LISTEN_HOST || '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(listenHost)) throw new Error('Invalid listen host.');
if (listenHost !== '127.0.0.1' && !process.env.CENTRAL_TRUSTED_CLOUDFLARED_IP && !process.env.CENTRAL_TRUSTED_PROXY_IP) throw new Error('A trusted tunnel connector IP is required for a non-loopback listener.');
if ((listenHost !== '127.0.0.1' || process.env.CENTRAL_RATE_LIMIT_KEY) && !/^[a-f0-9]{64}$/i.test(process.env.CENTRAL_RATE_LIMIT_KEY || '')) throw new Error('A valid persistent 32-byte rate-limit key is required.');

if (process.env.CENTRAL_TRUSTED_PROXY_IP && process.env.CENTRAL_TRUSTED_CLOUDFLARED_IP) throw new Error('Choose one trusted proxy mode.');
const cloudflareGate = process.env.CENTRAL_TRUSTED_PROXY_IP ? createProxyGate(process.env.CENTRAL_TRUSTED_PROXY_IP, process.env.CENTRAL_PUBLIC_ORIGIN) : process.env.CENTRAL_TRUSTED_CLOUDFLARED_IP ? createCloudflareGate(process.env.CENTRAL_TRUSTED_CLOUDFLARED_IP) : undefined;
const turnstileSiteKey = process.env.CENTRAL_TURNSTILE_SITE_KEY || '';
const turnstileGate = createTurnstileGate({ secretKey: process.env.CENTRAL_TURNSTILE_SECRET_KEY || '' });
const rateLimitSecret = process.env.CENTRAL_RATE_LIMIT_KEY ? Buffer.from(process.env.CENTRAL_RATE_LIMIT_KEY, 'hex') : crypto.randomBytes(32);
const accountRateLimit = createMariaRateLimiter({ pool, namespace: 'account', limit: 10, secret: rateLimitSecret, identity: req => typeof req.body?.email === 'string' && req.body.email.length <= 254 ? req.body.email.trim().toLowerCase() : 'invalid' });

accounts.cleanExpired().catch(() => console.error('Nie udalo sie usunac wygaslych sesji.'));
setInterval(() => {
  accounts.cleanExpired().catch(() => console.error('Nie udalo sie usunac wygaslych sesji.'));
}, 3600000).unref();

const shareRouter = process.env.SHARE_MASTER_KEY && process.env.SHARE_PUBLISH_SECRET ? createShareRouter({
  dataDir: process.env.SHARE_DATA_DIR || path.join(__dirname, 'share-data'),
  masterKey: process.env.SHARE_MASTER_KEY,
  publisherSecret: process.env.SHARE_PUBLISH_SECRET,
  publicBase: process.env.SHARE_PUBLIC_BASE || process.env.CENTRAL_PUBLIC_ORIGIN || verificationUrl.origin
}) : undefined;

const desktopDownloadCfg = resolveDesktopDownloadConfig(process.env, verificationUrl.origin);
const desktopDownload = {
  ...desktopDownloadCfg,
  sendEmail: async (email) => {
    const mail = buildDesktopDownloadEmail(desktopDownloadCfg);
    await transport.sendMail({ from: CENTRAL_SMTP_FROM, to: email, subject: mail.subject, text: mail.text });
  },
};

const playBilling=createPlayBilling({pool,getSession:accounts.getSession});
ensureEntitlementsSchema(pool).then(()=>ensureCatalogSchema(pool)).then(()=>ensureLedgerSchema(pool)).then(()=>ensureBillingSchema(pool)).then(()=>ensureFeedbackSchema(pool)).then(()=>{void playBilling.refreshDue().catch(()=>console.error('Nie udało się odświeżyć subskrypcji.'));setInterval(()=>{void playBilling.refreshDue().catch(()=>console.error('Nie udało się odświeżyć subskrypcji.'));},300000).unref();return createHttpApp(accounts, {
  entitlements:createEntitlements({pool,getSession:accounts.getSession,privateKey:process.env.CENTRAL_ENTITLEMENT_PRIVATE_KEY,catalogReader:getCatalog}),
  ledger:createCentralLedger({pool}),
  catalog:{get:()=>getCatalog(pool),save:value=>saveCatalog(pool,value),adminToken:process.env.CENTRAL_CATALOG_ADMIN_TOKEN},
  playBilling,
  feedback:createFeedbackService({pool,getSession:accounts.getSession}),
  shareRouter,
  desktopDownload,
  rateLimit: createMariaRateLimiter({ pool }),
  accountRateLimit,
  handoffRateLimit: createMariaRateLimiter({ pool, namespace: 'handoff', limit: 1000, windowMs: 300000 }),
  handoffStartRateLimit: createMariaRateLimiter({ pool, namespace: 'handoff-start', limit: 30, windowMs: 300000 }),
  cloudflareGate,
  turnstileGate,
  googleWebClientId,
  turnstileSiteKey,
  appUrl: process.env.CENTRAL_APP_URL || (listenHost === '127.0.0.1' ? 'http://127.0.0.1:5173/?account=login' : '')
}).listen(port, listenHost, () => console.log(`Central account API (MariaDB) listening on ${listenHost}:${port}`));}).then((server) => {
  const shutdown = (signal) => {
    console.log(`[central-accounts] Received ${signal}, shutting down gracefully...`);
    server.close(() => { void pool.end().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}).catch(error=>{console.error('Central account startup failed:',error.code||error.message);process.exit(1);});
