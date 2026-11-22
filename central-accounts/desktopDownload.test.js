'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpApp } = require('./httpApp');
const {
  detectDesktopOs,
  resolveDesktopDownloadConfig,
  renderDesktopDownloadPage,
  buildDesktopDownloadEmail,
} = require('./desktopDownload');

test('detectDesktopOs distinguishes Windows, macOS, and iOS', () => {
  assert.equal(detectDesktopOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win');
  assert.equal(detectDesktopOs('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'mac');
  assert.equal(detectDesktopOs('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'other');
});

test('renderDesktopDownloadPage shows OS-specific primary download link', () => {
  const cfg = resolveDesktopDownloadConfig({
    CENTRAL_PUBLIC_ORIGIN: 'https://konto.arecki.pl',
    CENTRAL_DESKTOP_WIN_URL: 'https://konto.arecki.pl/files/MojaTeczka-Setup.exe',
    CENTRAL_DESKTOP_MAC_URL: 'https://konto.arecki.pl/files/MojaTeczka.dmg',
  });

  const winHtml = renderDesktopDownloadPage({ ...cfg, userAgent: 'Windows NT 10.0' });
  assert.match(winHtml, /Pobierz MojaTeczka dla Windows/);
  assert.match(winHtml, /MojaTeczka-Setup\.exe/);

  const macHtml = renderDesktopDownloadPage({ ...cfg, userAgent: 'Macintosh; Intel Mac OS X' });
  assert.match(macHtml, /Pobierz MojaTeczka dla macOS/);
  assert.match(macHtml, /MojaTeczka\.dmg/);
});

test('buildDesktopDownloadEmail includes /pc link and direct installer links', () => {
  const mail = buildDesktopDownloadEmail({
    pcUrl: 'https://konto.arecki.pl/pc',
    winUrl: 'https://konto.arecki.pl/files/MojaTeczka-Setup.exe',
    macUrl: '',
  });
  assert.match(mail.subject, /MojaTeczka/);
  assert.match(mail.text, /https:\/\/konto\.arecki\.pl\/pc/);
  assert.match(mail.text, /MojaTeczka-Setup\.exe/);
});


test('createHttpApp serves GET /pc and POST /desktop-download/email without ReferenceError', async () => {
  const sentTo = [];
  const validToken = 'a'.repeat(43);
  const accounts = {
    getSession: async (token) => (token === validToken ? { id: 'u1', email: 'jan@example.com', name: 'Jan' } : null),
  };
  const app = createHttpApp(accounts, {
    desktopDownload: {
      origin: 'https://konto.arecki.pl',
      pcUrl: 'https://konto.arecki.pl/pc',
      winUrl: 'https://konto.arecki.pl/files/MojaTeczka-Setup.exe',
      macUrl: '',
      sendEmail: async (email) => { sentTo.push(email); },
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const pcRes = await fetch(`${base}/pc`, { headers: { 'user-agent': 'Windows NT 10.0' } });
    assert.equal(pcRes.status, 200);
    const html = await pcRes.text();
    assert.match(html, /MojaTeczka-Setup\.exe/);

    const unauthRes = await fetch(`${base}/desktop-download/email`, { method: 'POST' });
    assert.equal(unauthRes.status, 401);

    const okRes = await fetch(`${base}/desktop-download/email`, {
      method: 'POST',
      headers: { authorization: `Bearer ${validToken}` },
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.email, 'jan@example.com');
    assert.deepEqual(sentTo, ['jan@example.com']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
