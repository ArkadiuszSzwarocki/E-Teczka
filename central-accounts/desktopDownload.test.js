'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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
