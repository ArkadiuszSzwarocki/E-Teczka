const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./accountUi'), 'utf8');
async function page({ hash = '', storedHandoff, inspectFails = false } = {}) {
  const storage = new Map([['eteczka_central_session', 'test-session']]);
  if (storedHandoff) storage.set('eteczka_central_handoff', storedHandoff);
  const elements = new Map(); const calls = [];
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: true, value: '', disabled: true, textContent: '', addEventListener() {}, replaceChildren() {} }); return elements.get(id); };
  vm.runInNewContext(source, { URL, location: { hash, pathname: '/account' }, history: { replaceState() {} }, window: {}, document: { getElementById: element }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, fetch: async path => {
    calls.push(path);
    if (path === '/public-config') return { json: async () => ({ appUrl: 'http://127.0.0.1:5173/?account=login' }) };
    if (path === '/me') return { ok: true, json: async () => ({ email: 'test@example.com' }) };
    return { ok: !inspectFails, status: inspectFails ? 400 : 200, json: async () => inspectFails ? { error: 'Expired' } : { deviceName: 'Desktop', displayCode: '123456' } };
  } });
  await new Promise(resolve => setImmediate(resolve));
  return { element, storage, calls };
}
test('signed in account without device request offers a clear return to the application', async () => {
  const { element } = await page();
  assert.equal(element('signedInNext').hidden, false);
  assert.match(element('nextMessage').textContent, /nie wymaga porównywania kodu/);
  assert.equal(element('returnToApp').href, 'http://127.0.0.1:5173/?account=login');
  assert.equal(element('returnToApp').hidden, false);
});
test('device request survives refresh and is discarded after expiry', async () => {
  const request = 'a'.repeat(43);
  const initial = await page({ hash: '#' + request });
  assert.equal(initial.storage.get('eteczka_central_handoff'), request);
  const refreshed = await page({ storedHandoff: request });
  assert.ok(refreshed.calls.includes('/handoff/inspect'));
  assert.equal(refreshed.element('handoff').hidden, false);
  const expired = await page({ storedHandoff: request, inspectFails: true });
  assert.equal(expired.storage.has('eteczka_central_handoff'), false);
  assert.equal(expired.element('approveHandoff').disabled, true);
});
