const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { makeLocalTls } = require('../services/localTls');

test('local HTTPS uses persistent CA and validates certificate and hostname', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-tls-'));
  let server;
  try {
    const first = makeLocalTls(dir, ['127.0.0.1']);
    const again = makeLocalTls(dir, ['127.0.0.1']);
    assert.equal(first.fingerprint, again.fingerprint);
    server = https.createServer({ key: again.key, cert: again.cert }, (_req, res) => res.end('ok'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = options => new Promise((resolve, reject) => https.get({ host: '127.0.0.1', port, ...options }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject));
    assert.equal(await request({ ca: first.caPem }), 200);
    await assert.rejects(request({}), /certificate/i);
    await assert.rejects(request({ ca: first.caPem, servername: 'unrelated.example' }), /altname|hostname/i);
  } finally { if (server) await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('incomplete CA is rejected without overwriting the private key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-tls-'));
  try { const key = path.join(dir, 'local-ca-key.pem'); fs.writeFileSync(key, 'do not overwrite'); assert.throws(() => makeLocalTls(dir), /Niekompletny/); assert.equal(fs.readFileSync(key, 'utf8'), 'do not overwrite'); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('remote HTTP is rejected while local desktop and remote TLS can proceed', () => {
  const { requireSecureRemote } = require('../middleware/requireSecureRemote');
  const check = (remoteAddress, encrypted) => {
    let status = 0; let proceeded = false;
    const res = { status(code) { status = code; return this; }, json() {} };
    requireSecureRemote({ socket: { remoteAddress, encrypted } }, res, () => { proceeded = true; });
    return { status, proceeded };
  };
  assert.deepEqual(check('192.168.0.30', false), { status: 426, proceeded: false });
  assert.deepEqual(check('192.168.0.30', true), { status: 0, proceeded: true });
  assert.deepEqual(check('::ffff:127.0.0.1', false), { status: 0, proceeded: true });
});
