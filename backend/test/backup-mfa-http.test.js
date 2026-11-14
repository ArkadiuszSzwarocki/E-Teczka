const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('isolated backup MFA HTTP integration', () => {
  execFileSync(process.execPath, ['--test', path.join(__dirname, 'fixtures', 'backup-mfa-isolated.cjs')], { stdio: 'pipe' });
});
