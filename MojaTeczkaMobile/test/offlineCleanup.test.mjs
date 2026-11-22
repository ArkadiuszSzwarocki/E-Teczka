import test from 'node:test';
import assert from 'node:assert/strict';
import { getOfflineCacheBytes, removeOfflineFiles } from '../src/services/offlineCleanup.ts';

test('cleanup removes offline copies and viewer cache without touching drafts or security data', async () => {
  const files = new Map([
    ['vault/index.enc', 100], ['vault/ocr-42.enc', 400], ['vault/ocr-42.enc.123.tmp', 10], ['vault/42.enc', 1000], ['vault/42.manifest.enc', 200],
    ['vault/42.chunks-0123456789abcdef', 500], ['vault/unrelated.txt', 15],
    ['cache/vault-50', 1400], ['cache/mojateczka_v2_50.jpg.123-abc.download', 1000],
    ['cache/opened-42.pdf', 900], ['cache/scan_draft_42.jpg', 600], ['cache/mojateczka_mail_42.pdf', 700],
    ['documents/scan_draft_42.jpg', 2000], ['sync/state.json', 500],
  ]);
  const fs = {
    async getInfoAsync(path) { if (path === 'vault/' || path === 'cache/') return { exists: true, isDirectory: true }; return files.has(path) ? { exists: true, isDirectory: false, size: files.get(path) } : { exists: false }; },
    async readDirectoryAsync(path) { return [...files.keys()].filter(name => name.startsWith(path) && !name.slice(path.length).includes('/')).map(name => name.slice(path.length)); },
    async deleteAsync(path) { files.delete(path); },
  };
  assert.equal(await getOfflineCacheBytes(fs, 'cache/'), 3300);
  assert.equal(await removeOfflineFiles(fs, 'vault/', 'cache/'), 8);
  for (const name of ['vault/index.enc', 'vault/unrelated.txt', 'cache/scan_draft_42.jpg', 'cache/mojateczka_mail_42.pdf', 'documents/scan_draft_42.jpg', 'sync/state.json']) assert.ok(files.has(name), name);
  assert.equal(await getOfflineCacheBytes(fs, 'cache/'), 0);
});
