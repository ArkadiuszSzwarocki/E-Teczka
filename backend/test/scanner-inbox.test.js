const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('scanner inbox saves a PDF and moves it to the selected folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eteczka-inbox-test-'));
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'scanner-inbox-child.js')], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
