import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../src/services/networkRequest.ts';

test('network cancellation becomes a useful connection message', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Fetch request has been canceled'); });
  await assert.rejects(fetchWithTimeout('http://localhost', {}, 1000, 'Synchronizacja'), /połączenie z komputerem zostało przerwane/);
});

test('timeout identifies the stage and does not expose the native error', async (t) => {
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('canceled')))));
  await assert.rejects(fetchWithTimeout('http://localhost', {}, 10, 'Pobieranie listy'), /Pobieranie listy: komputer nie odpowiedział/);
});
