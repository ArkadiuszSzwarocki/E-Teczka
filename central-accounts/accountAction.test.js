const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./accountAction'), 'utf8');
async function page(path, hash, fail = false) {
  const elements = new Map(), calls = [], stored = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { hidden: true, value: '', textContent: '', addEventListener(name, callback) { this[name] = callback; } }); return elements.get(id); };
  vm.runInNewContext(source, { location: { pathname: path, hash }, history: { replaceState() {} }, document: { getElementById: element }, sessionStorage: { getItem: key => stored.get(key), setItem: (key,value) => stored.set(key,value), removeItem: key => stored.delete(key) }, fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ message: 'OK' }) }; } });
  await new Promise(resolve => setImmediate(resolve));
  return { element, calls, stored };
}
test('email link confirms automatically with token alone and leaves no additional confirmation form', async () => {
  const token = 'a'.repeat(43); const { element, calls, stored } = await page('/verify', '#' + token);
  assert.deepEqual(calls, [{ url: '/verify-email', body: { token } }]);
  assert.equal(element('form').hidden, true); assert.match(element('title').textContent, /potwierdzony/);
  assert.match(element('hint').textContent, /aplikacji/); assert.equal(stored.get('eteczka_email_verified'), 'yes');
});
test('reset link waits for the user to choose a new password and malformed links do not send requests', async () => {
  const reset = await page('/reset', '#' + 'a'.repeat(43)); assert.equal(reset.calls.length, 0); assert.equal(reset.element('form').hidden, false);
  const invalid = await page('/verify', '#bad'); assert.equal(invalid.calls.length, 0); assert.match(invalid.element('title').textContent, /Nieprawidłowy/);
});
test('network failure offers retry rather than a second confirmation step', async () => {
  const { element } = await page('/verify', '#' + 'a'.repeat(43), true);
  assert.equal(element('form').hidden, false); assert.equal(element('submit').textContent, 'Spróbuj ponownie');
});
