const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('isolated WebDAV backup download integration', () => {
  execFileSync(process.execPath, ['--test', path.join(__dirname, 'fixtures', 'backup-webdav-download.cjs')], { stdio: 'pipe' });
});
