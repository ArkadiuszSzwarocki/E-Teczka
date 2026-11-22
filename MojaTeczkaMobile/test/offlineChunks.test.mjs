import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import CryptoJS from 'crypto-js';
import { createOfflineChunkCodec } from '../src/services/offlineChunkCodec.ts';

const files = new Map();
const directories = new Set();
const fs = {
  EncodingType: { Base64: 'base64' },
  async getInfoAsync(path) { if (files.has(path)) return { exists: true, isDirectory: false, size: files.get(path).length }; if (directories.has(path)) return { exists: true, isDirectory: true }; return { exists: false }; },
  async makeDirectoryAsync(path) { directories.add(path); },
  async readAsStringAsync(path, options = {}) { const data = files.get(path); if (!data) throw new Error('missing'); const part = options.length === undefined ? data : data.subarray(options.position, options.position + options.length); return part.toString(options.encoding === 'base64' ? 'base64' : 'utf8'); },
  async writeAsStringAsync(path, value, options = {}) { const next = Buffer.from(value, options.encoding === 'base64' ? 'base64' : 'utf8'); files.set(path, options.append && files.has(path) ? Buffer.concat([files.get(path), next]) : next); },
  async moveAsync({ from, to }) { if (!files.has(from)) throw new Error('missing'); files.set(to, files.get(from)); files.delete(from); },
  async deleteAsync(path) { files.delete(path); for (const name of files.keys()) if (name.startsWith(path)) files.delete(name); directories.delete(path); },
};
const { createOfflineChunkStore } = await import('../src/services/offlineChunks.ts');
const { encryptFileInChunks, readChunkManifest, decryptFileInChunks } = createOfflineChunkStore(fs, async length => new Uint8Array(randomBytes(length)));
const codec = { encrypt: async value => Buffer.from(value, 'utf8').toString('base64'), decrypt: async value => Buffer.from(value, 'base64').toString('utf8') };
const compactCodec = { ...codec, ...createOfflineChunkCodec(async () => CryptoJS.enc.Hex.parse('11'.repeat(32)), async length => new Uint8Array(randomBytes(length))) };

test('multi-chunk file can be stored and restored byte for byte', async () => {
  const original = randomBytes(700_001); files.set('source', original);
  await encryptFileInChunks('vault/', 7, 'source.pdf', 'source', codec);
  const manifest = await readChunkManifest('vault/', 7, codec);
  assert.ok(manifest.chunks > 1);
  await decryptFileInChunks('vault/', 7, 'result', manifest, codec);
  assert.deepEqual(files.get('result'), original);
});

test('failed encryption keeps the previously committed copy', async () => {
  const original = randomBytes(300_000); files.set('source-old', original);
  await encryptFileInChunks('vault/', 8, 'old.pdf', 'source-old', codec);
  const old = await readChunkManifest('vault/', 8, codec);
  files.set('source-new', randomBytes(500_000)); let count = 0;
  const broken = { ...codec, encrypt: async value => { if (++count === 2) throw new Error('storage failure'); return codec.encrypt(value); } };
  await assert.rejects(encryptFileInChunks('vault/', 8, 'new.pdf', 'source-new', broken));
  const current = await readChunkManifest('vault/', 8, codec);
  assert.equal(current.directory, old.directory);
  await decryptFileInChunks('vault/', 8, 'result-old', current, codec);
  assert.deepEqual(files.get('result-old'), original);
});

test('compact encrypted chunks round-trip and detect tampering', async () => {
  const original = randomBytes(500_002); files.set('source-compact', original);
  await encryptFileInChunks('vault/', 9, 'compact.pdf', 'source-compact', compactCodec);
  const manifest = await readChunkManifest('vault/', 9, compactCodec);
  const chunks = [...files.entries()].filter(([name]) => name.startsWith(`vault/${manifest.directory}/`));
  assert.ok(chunks.reduce((total, [, data]) => total + data.length, 0) < original.length * 1.35);
  await decryptFileInChunks('vault/', 9, 'result-compact', manifest, compactCodec);
  assert.deepEqual(files.get('result-compact'), original);
  const [name, first] = chunks[0]; const damaged = Buffer.from(first); damaged[40] = damaged[40] === 65 ? 66 : 65; files.set(name, damaged);
  await assert.rejects(decryptFileInChunks('vault/', 9, 'result-damaged', manifest, compactCodec));
  assert.equal(files.has('result-damaged'), false);
});
