'use strict';
// Tests must never read the operator's real backup credentials or share cwd.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const parent = fs.realpathSync(os.tmpdir());
const sandbox = fs.mkdtempSync(path.join(parent, 'eteczka-tests-'));
const pattern = path.resolve(__dirname, '..', 'test', '*.test.js');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', pattern], { cwd: sandbox, stdio: 'inherit', env: {...process.env,NODE_ENV:'test',ETECZKA_CENTRAL_ACCOUNT_URL:''} });
try {
  const actual = fs.realpathSync(sandbox);
  if (path.dirname(actual) === parent && path.basename(actual).startsWith('eteczka-tests-')) fs.rmSync(actual, { recursive: true, force: true });
} catch (error) { console.error('Nie udało się usunąć katalogu testowego:', error.message); }
if (result.error) { console.error('Nie udało się uruchomić testów:', result.error.message); process.exitCode = 1; }
else process.exitCode = result.status === null ? 1 : result.status;
