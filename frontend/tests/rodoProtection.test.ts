import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectRodoMatches,
  maskRodoText,
  setDocumentRodoOverride,
  shouldProtectDocument,
} from '../src/services/rodoProtection.ts';

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

test('does not lock clean Regulamin without RODO data', () => {
  setupLocalStorageMock();
  const decision = shouldProtectDocument({
    docId: 101,
    title: 'Regulamin korzystania z serwisu.pdf',
    ocrText: 'Niniejszy regulamin określa zasady korzystania z aplikacji oraz prawa i obowiązki użytkowników.',
    maskingEnabled: true,
    smartEnabled: true,
  });
  assert.equal(decision.protect, false);
  assert.equal(decision.reason, 'no_rodo_data');
});

test('detects and masks PESEL, address, email, and medical data with [RODO: ...] tags', () => {
  setupLocalStorageMock();
  const text = [
    'Pan Jan Kowalski, PESEL: 90010112345',
    'Zamieszkały: ul. Kwiatowa 12/4, 00-950 Warszawa',
    'Kontakt: jan.kowalski@example.com, tel. 600 123 456',
    'Rozpoznanie: ICD-10 J06',
  ].join('\n');

  const detected = detectRodoMatches(text, ['pesel', 'full_name', 'address', 'contact', 'medical']);
  assert.equal(detected.count, 5);

  const masked = maskRodoText(text, ['pesel', 'full_name', 'address', 'contact', 'medical']);
  assert.ok(masked.includes('[RODO: PESEL]'));
  assert.ok(masked.includes('[RODO: ADRES]'));
  assert.ok(masked.includes('[RODO: KONTAKT]'));
  assert.ok(masked.includes('[RODO: DANE MEDYCZNE]'));
  assert.ok(masked.includes('[RODO: IMIĘ I NAZWISKO]'));
  assert.equal(masked.includes('90010112345'), false);
  assert.equal(masked.includes('jan.kowalski@example.com'), false);
});

test('respects user-selected RODO categories', () => {
  setupLocalStorageMock();
  const decision = shouldProtectDocument({
    docId: 202,
    title: 'Kontakt.pdf',
    ocrText: 'Adres e-mail: biuro@firma.pl',
    maskingEnabled: true,
    categories: ['pesel', 'bank_account'],
    smartEnabled: true,
  });
  assert.equal(decision.protect, false);
  assert.equal(decision.reason, 'no_rodo_data');
});

test('respects per-document manual overrides (always / never)', () => {
  setupLocalStorageMock();
  setDocumentRodoOverride(303, 'always');
  const forced = shouldProtectDocument({
    docId: 303,
    title: 'Regulamin.pdf',
    ocrText: 'Brak danych osobowych.',
    maskingEnabled: true,
    smartEnabled: true,
  });
  assert.equal(forced.protect, true);
  assert.equal(forced.reason, 'manual_always');

  setDocumentRodoOverride(404, 'never');
  const skipped = shouldProtectDocument({
    docId: 404,
    title: 'Umowa.pdf',
    ocrText: 'PESEL 90010112345',
    maskingEnabled: true,
    smartEnabled: true,
  });
  assert.equal(skipped.protect, false);
  assert.equal(skipped.reason, 'manual_never');
});

test('detects ALL CAPS patient name, landline phone, and e-recepta medical data', () => {
  setupLocalStorageMock();
  const erecepta = [
    'erecepta',
    'Pacjent FILIP SZWAROCKI',
    'Wystawca LEKARZ IZABELA KOŚCIUCZYK',
    'PWZ lekarza 7769341',
    'tel: (46)4646008',
    'Recepta 1 z 1',
  ].join('\n');
  const decision = shouldProtectDocument({
    docId: 505,
    title: 'recepta.png',
    ocrText: erecepta,
    maskingEnabled: true,
    smartEnabled: true,
  });
  assert.equal(decision.protect, true);
  assert.ok(decision.matchedLabels.includes('Imię i nazwisko'));
  assert.ok(decision.matchedLabels.includes('Telefon / E-mail'));
  assert.ok(decision.matchedLabels.includes('Dane medyczne (art. 9)'));
});
