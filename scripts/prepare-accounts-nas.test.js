const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare } = require('./prepare-accounts-nas');

test('deployment bundle contains runtime sources and a separate env file, with no local dependencies or tests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-nas-package-'));
  const source = path.join(root, 'source'), target = path.join(root, 'bundle');
  fs.mkdirSync(path.join(source, 'mariadb'), { recursive: true });
  const runtime = path.resolve(__dirname, '../central-accounts');
  for (const file of fs.readdirSync(runtime)) {
    if (fs.statSync(path.join(runtime, file)).isFile() && file !== '.env') fs.copyFileSync(path.join(runtime, file), path.join(source, file));
  }
  fs.writeFileSync(path.join(source, 'mariadb', 'database.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(source, 'mariadb', 'database.test.js'), 'test fixture');
  fs.writeFileSync(path.join(source, '.env'), [
    'CENTRAL_MARIADB_HOST=192.168.0.12', 'CENTRAL_MARIADB_DATABASE=E-Teczka', 'CENTRAL_MARIADB_USER=test',
    "CENTRAL_MARIADB_PASSWORD=literal$PASSWORD", 'CENTRAL_SMTP_HOST=smtp.example.invalid', 'CENTRAL_SMTP_USER=test',
    'CENTRAL_SMTP_PASSWORD=test-only', 'CENTRAL_SMTP_FROM=test@example.invalid', 'UNRELATED_SECRET=excluded'
  ].join('\n'));
  try {
    prepare(source, target);
    const env = fs.readFileSync(path.join(target, '.env.nas'), 'utf8');
    assert.match(env, /CENTRAL_MARIADB_PASSWORD='literal\$PASSWORD'/);
    assert.match(env, /CENTRAL_RATE_LIMIT_KEY='[a-f0-9]{64}'/);
    assert.doesNotMatch(env, /UNRELATED_SECRET/);
    assert.equal(fs.existsSync(path.join(target, '.env')), false);
    assert.equal(fs.existsSync(path.join(target, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(target, 'mariadb/database.test.js')), false);
    assert.equal(fs.existsSync(path.join(target, 'mariadb/database.js')), true);
    assert.equal(fs.existsSync(path.join(target, 'accountAction.html')), true);
  } finally {
    const resolved = fs.realpathSync(root);
    if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith('mojateczka-nas-package-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
