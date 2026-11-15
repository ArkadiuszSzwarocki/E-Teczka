'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');

function prepare(source, target) {
  const env = parseEnv(fs.readFileSync(path.join(source, '.env'), 'utf8'));
  const required = ['CENTRAL_MARIADB_HOST', 'CENTRAL_MARIADB_DATABASE', 'CENTRAL_MARIADB_USER', 'CENTRAL_MARIADB_PASSWORD', 'CENTRAL_SMTP_HOST', 'CENTRAL_SMTP_USER', 'CENTRAL_SMTP_PASSWORD', 'CENTRAL_SMTP_FROM'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error('Brakuje konfiguracji: ' + missing.join(', '));
  const files = ['Dockerfile', '.dockerignore', 'compose.nas.yml', 'package.json', 'package-lock.json', 'account.html', 'accountAction.html', 'account.css', 'accountAction.js', 'accountUi.js', 'cloudflareGate.js', 'proxyGate.js', 'googleIdentity.js', 'httpApp.js', 'index.js'];
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) fs.copyFileSync(path.join(source, file), path.join(target, file));
  fs.mkdirSync(path.join(target, 'mariadb'));
  for (const file of fs.readdirSync(path.join(source, 'mariadb'))) {
    if (file.endsWith('.js') && !file.endsWith('.test.js')) fs.copyFileSync(path.join(source, 'mariadb', file), path.join(target, 'mariadb', file));
  }
  const keys = [...required, 'CENTRAL_MARIADB_PORT', 'CENTRAL_SMTP_PORT', 'CENTRAL_GOOGLE_CLIENT_IDS', 'CENTRAL_GOOGLE_WEB_CLIENT_ID'];
  const selected = Object.fromEntries(keys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  selected.CENTRAL_RATE_LIMIT_KEY = /^[a-f0-9]{64}$/i.test(env.CENTRAL_RATE_LIMIT_KEY || '') ? env.CENTRAL_RATE_LIMIT_KEY : crypto.randomBytes(32).toString('hex');
  const quote = value => {
    if (/[\r\n\0]/.test(value)) throw new Error('Konfiguracja zawiera niedozwolone znaki wielowierszowe.');
    return "'" + value.replace(/'/g, "\\'") + "'";
  };
  fs.writeFileSync(path.join(target, '.env.nas'), Object.entries(selected).map(([key, value]) => key + '=' + quote(value)).join('\n') + '\n', { mode: 0o600 });
}
if (require.main === module) {
  try { prepare(process.argv[2], process.argv[3]); console.log('Przygotowano kod i konfiguracje NAS (bez wyswietlania sekretow).'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
