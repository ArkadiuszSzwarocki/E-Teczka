const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAccessLock } = require('./accessLock');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojateczka-lock-'));
  const file = path.join(dir, 'access-lock.json');
  let clock = 1_000_000;
  const mail = [];
  const service = createAccessLock({ file, mailConfigured: true, now: () => clock, sendRecoveryMail: async (to, code, purpose) => { mail.push({ to, code, purpose }); } });
  return { service, mail, advance: ms => { clock += ms; }, close: () => { if (fs.existsSync(file)) fs.unlinkSync(file); fs.rmdirSync(dir); }, file };
}

test('email reset requires a previously verified recovery address', async () => {
  const context = fixture();
  try {
    const { service, mail } = context;
    assert.equal(service.configure({ mode: 'password', secret: 'old-password' }, false).ok, true);
    assert.equal((await service.requestReset()).ok, false);
    assert.equal((await service.requestEnrollment('person@example.com', false)).ok, false);
    assert.equal(service.verify('old-password').ok, true);
    assert.equal((await service.requestEnrollment('person@example.com', true)).ok, true);
    assert.equal(service.configure({ mode: 'password', secret: 'new-password', recoveryEmail: 'person@example.com', recoveryCode: '00000000' }, true).ok, false);
    assert.equal(service.configure({ mode: 'password', secret: 'new-password', recoveryEmail: 'person@example.com', recoveryCode: mail[0].code }, true).ok, true);
    assert.equal(service.status().recoveryAvailable, true);
    context.advance(60_001);
    assert.equal((await service.requestReset()).ok, true);
    assert.equal(mail[1].to, 'person@example.com');
    assert.equal(service.completeReset({ code: mail[1].code, mode: 'password', secret: 'reset-password' }).ok, true);
    assert.equal(service.verify('reset-password').ok, true);
    assert.equal(service.verify('new-password').ok, false);
    assert.equal(service.completeReset({ code: mail[1].code, mode: 'password', secret: 'replay-password' }).ok, false);
  } finally { context.close(); }
});

test('reset codes expire and are rate limited', async () => {
  const context = fixture();
  try {
    const { service, mail } = context;
    assert.equal((await service.requestEnrollment('owner@example.com', false)).ok, true);
    assert.equal(service.configure({ mode: 'pin', secret: '123456', recoveryEmail: 'owner@example.com', recoveryCode: mail[0].code }, false).ok, true);
    assert.equal((await service.requestReset()).ok, false);
    context.advance(60_001);
    assert.equal((await service.requestReset()).ok, true);
    context.advance(10 * 60_000 + 1);
    assert.equal(service.completeReset({ code: mail[1].code, mode: 'pin', secret: '654321' }).ok, false);
    assert.equal(service.verify('123456').ok, true);
  } finally { context.close(); }
});

test('legacy lock without recovery address remains inaccessible through email reset', async () => {
  const context = fixture();
  try {
    context.service.configure({ mode: 'password', secret: 'legacy-password' }, false);
    const stored = JSON.parse(fs.readFileSync(context.file, 'utf8'));
    assert.equal(stored.recoveryEmail, undefined);
    assert.equal((await context.service.requestReset()).ok, false);
  } finally { context.close(); }
});

test('existing password can enroll a recovery address without changing the password', async () => {
  const context = fixture();
  try {
    const { service, mail } = context;
    assert.equal(service.configure({ mode: 'password', secret: 'known-password' }, false).ok, true);
    assert.equal((await service.requestEnrollment('owner@example.com', true)).ok, true);
    assert.equal(service.completeEnrollment('owner@example.com', mail[0].code, false).ok, false);
    assert.equal(service.completeEnrollment('owner@example.com', mail[0].code, true).ok, true);
    assert.equal(service.verify('known-password').ok, true);
    assert.equal(service.status().recoveryAvailable, true);
  } finally { context.close(); }
});
