import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDocumentRodoPhrase,
  addDocumentRodoRegion,
  getDocumentRodoPhrases,
  getDocumentRodoRegions,
  maskCustomRodoPhrases,
  removeDocumentRodoPhrase,
  removeDocumentRodoRegion,
} from '../src/services/rodoRegions.ts';

function setupLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

test('adds, clamps, persists, and removes manual RODO regions per document', () => {
  setupLocalStorageMock();
  assert.deepEqual(getDocumentRodoRegions(15), []);

  const added = addDocumentRodoRegion(15, { x: 10.5, y: 20.25, w: 30, h: 12, label: 'PESEL' });
  assert.equal(added.length, 1);
  assert.equal(added[0].label, 'PESEL');
  assert.equal(getDocumentRodoRegions(15).length, 1);
  assert.equal(getDocumentRodoRegions(16).length, 0);

  const afterRemove = removeDocumentRodoRegion(15, added[0].id);
  assert.deepEqual(afterRemove, []);
  assert.deepEqual(getDocumentRodoRegions(15), []);
});

test('saves, masks only characters with mosaic squares, and removes selected OCR phrases', () => {
  setupLocalStorageMock();
  const phrases = addDocumentRodoPhrase(22, 'Jan Kowalski');
  assert.deepEqual(phrases, ['Jan Kowalski']);
  assert.equal(getDocumentRodoPhrases(22).length, 1);

  const masked = maskCustomRodoPhrases('Klient: Jan Kowalski zawarł umowę.', phrases);
  assert.equal(masked, 'Klient: ▪▪▪ ▪▪▪▪▪▪▪▪ zawarł umowę.');

  assert.deepEqual(removeDocumentRodoPhrase(22, 'Jan Kowalski'), []);
});
