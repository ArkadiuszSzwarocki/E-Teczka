import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sliceBase64ForResumable, uploadChunksResumable } from '../src/services/resumableUpload.ts';

test('resumable upload recovers from mid-transfer Wi-Fi drop without re-sending received chunks', async () => {
  const original = randomBytes(120_000);
  const chunksBase64 = sliceBase64ForResumable(original.toString('base64'), 32_000);
  assert.ok(chunksBase64.length >= 4);

  const serverSessions = new Map();
  const uploadedIndices = [];
  let dropSimulated = false;

  const mockFetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/upload-resumable/init')) {
      const uploadId = body.uploadId || 'sess-12345678';
      if (!serverSessions.has(uploadId)) {
        serverSessions.set(uploadId, new Map());
      }
      const receivedChunks = Array.from(serverSessions.get(uploadId).keys());
      return new Response(JSON.stringify({ uploadId, receivedChunks }), { status: 200 });
    }
    const chunkMatch = url.match(/\/upload-resumable\/([^/]+)\/chunk\/(\d+)$/);
    if (chunkMatch) {
      const [, uploadId, idxStr] = chunkMatch;
      const idx = Number(idxStr);
      if (idx === 2 && !dropSimulated) {
        dropSimulated = true;
        throw new Error('Network request failed (Wi-Fi dropped)');
      }
      uploadedIndices.push(idx);
      serverSessions.get(uploadId).set(idx, Buffer.from(body.data, 'base64'));
      return new Response(JSON.stringify({ uploadId, index: idx, received: true }), { status: 200 });
    }
    if (url.endsWith('/complete')) {
      const uploadId = url.split('/').slice(-2, -1)[0];
      const map = serverSessions.get(uploadId);
      const assembled = Buffer.concat(Array.from({ length: chunksBase64.length }, (_, i) => map.get(i)));
      return new Response(JSON.stringify({ success: true, document: { id: 99, size: assembled.length }, bytesBase64: assembled.toString('base64') }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  // First attempt fails on chunk 2 due to Wi-Fi drop
  await assert.rejects(
    uploadChunksResumable({
      apiBaseUrl: 'https://test.local',
      headers: {},
      folderId: 5,
      fileName: 'skan.pdf',
      mimeType: 'application/pdf',
      chunksBase64,
      uploadId: 'sess-12345678',
      fetchFn: mockFetch,
    }),
    /Wi-Fi dropped/,
  );
  assert.deepEqual(uploadedIndices, [0, 1]);

  // Resume with the same uploadId: chunks 0 & 1 are skipped!
  const result = await uploadChunksResumable({
    apiBaseUrl: 'https://test.local',
    headers: {},
    folderId: 5,
    fileName: 'skan.pdf',
    mimeType: 'application/pdf',
    chunksBase64,
    uploadId: 'sess-12345678',
    fetchFn: mockFetch,
  });

  assert.equal(result.success, true);
  assert.deepEqual(uploadedIndices, [0, 1, 2, 3, 4]);
  assert.deepEqual(Buffer.from(result.bytesBase64, 'base64'), original);
});
