const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./accountUi'), 'utf8');
async function page({ hash = '', search = '', storedHandoff, inspectFails = false, google = false, approvalFails = false } = {}) {
  const storage = new Map([['mojateczka_central_session', 'test-session']]);
  if (storedHandoff) storage.set('mojateczka_central_handoff', storedHandoff);
  const elements = new Map(); const calls = [];
  let googleCallback;
  const googleApi = { initialize(options) { googleCallback = options.callback; }, renderButton() {}, prompt() {} };
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: true, value: '', disabled: true, textContent: '', addEventListener() {}, replaceChildren() {} }); return elements.get(id); };
  vm.runInNewContext(source, { URL, URLSearchParams, location: { hash, search, pathname: '/account' }, history: { replaceState() {} }, window: google ? { google: { accounts: { id: googleApi } } } : {}, document: { getElementById: element, createElement: () => ({}), head: { appendChild(script) { script.onload(); } } }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, fetch: async path => {
    calls.push(path);
    if (path === '/public-config') return { json: async () => ({ googleWebClientId: google ? 'web-client' : '', appUrl: 'http://127.0.0.1:5173/?account=login' }) };
    if (path === '/google-challenge') return { ok: true, json: async () => ({ nonce: 'n'.repeat(43) }) };
    if (path === '/google') return { ok: true, json: async () => ({ token: 'new-session', user: { email: 'user@gmail.com' } }) };
    if (path === '/handoff/approve' && approvalFails) return { ok: false, json: async () => ({ error: 'Expired' }) };
    if (path === '/me') return { ok: true, json: async () => ({ email: 'test@example.com' }) };
    return { ok: !inspectFails, status: inspectFails ? 400 : 200, json: async () => inspectFails ? { error: 'Expired' } : { deviceName: 'Desktop', displayCode: '123456' } };
  } });
  await new Promise(resolve => setImmediate(resolve));
  return { element, storage, calls, async signInGoogle() { googleCallback({ credential: 'credential' }); await new Promise(resolve => setImmediate(resolve)); } };
}
test('signed in account without device request offers a clear return to the application', async () => {
  const { element } = await page();
  assert.equal(element('signedInNext').hidden, false);
  assert.match(element('nextMessage').textContent, /nie wymaga porównywania kodu/);
  assert.equal(element('returnToApp').href, 'http://127.0.0.1:5173/?account=login');
  assert.equal(element('returnToApp').hidden, false);
});

test('Google-only entry hides password forms and does not reuse a previously signed-in account', async () => {
  const { element, calls } = await page({ search: '?login=google' });
  assert.equal(element('passwordCredentials').hidden, true);
  assert.equal(element('googleIntro').hidden, false);
  assert.equal(calls.includes('/me'), false);
  assert.equal(calls.includes('/handoff/approve'), false);
});

test('fresh Google login automatically completes handoff without a code confirmation and displays a close-tab message', async () => {
  const p = await page({ search: '?login=google', hash: '#' + 'a'.repeat(43), google: true });
  assert.equal(p.element('handoff').hidden, true);
  assert.equal(p.calls.includes('/handoff/approve'), false);
  await p.signInGoogle();
  assert.equal(p.calls.filter(path => path === '/handoff/approve').length, 1);
  assert.equal(p.storage.has('mojateczka_central_handoff'), false);
  assert.equal(p.element('credentials').hidden, true);
  assert.match(p.element('nextMessage').textContent, /zamknąć tę kartę/);
});

test('failed desktop handoff retains the request for retry and does not display completion', async () => {
  const p = await page({ search: '?login=google', hash: '#' + 'a'.repeat(43), google: true, approvalFails: true });
  await p.signInGoogle();
  assert.equal(p.storage.has('mojateczka_central_handoff'), true);
  assert.equal(p.element('status').textContent, 'Expired');
  assert.doesNotMatch(p.element('nextMessage').textContent, /zamknąć tę kartę/);
});
test('device request survives refresh and is discarded after expiry', async () => {
  const request = 'a'.repeat(43);
  const initial = await page({ hash: '#' + request });
  assert.equal(initial.storage.get('mojateczka_central_handoff'), request);
  const refreshed = await page({ storedHandoff: request });
  assert.ok(refreshed.calls.includes('/handoff/inspect'));
  assert.equal(refreshed.element('handoff').hidden, false);
  const expired = await page({ storedHandoff: request, inspectFails: true });
  assert.equal(expired.storage.has('mojateczka_central_handoff'), false);
  assert.equal(expired.element('approveHandoff').disabled, true);
});
