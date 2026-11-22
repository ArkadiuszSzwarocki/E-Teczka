'use strict';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeDownloadUrl(raw, fallback) {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return parsed.href;
  } catch { /* fallback */ }
  return fallback;
}

function resolveDesktopDownloadConfig(env = process.env, fallbackOrigin = 'https://konto.arecki.pl') {
  const origin = safeDownloadUrl(env.CENTRAL_PUBLIC_ORIGIN, fallbackOrigin).replace(/\/+$/, '');
  const pcUrl = `${origin}/pc`;
  const winUrl = safeDownloadUrl(env.CENTRAL_DESKTOP_WIN_URL, '');
  const macUrl = safeDownloadUrl(env.CENTRAL_DESKTOP_MAC_URL, '');
  return { origin, pcUrl, winUrl, macUrl };
}

function detectDesktopOs(userAgent = '') {
  const ua = String(userAgent || '');
  if (/macintosh|mac os x/i.test(ua) && !/iphone|ipad|ipod/i.test(ua)) return 'mac';
  if (/windows/i.test(ua)) return 'win';
  return 'other';
}

function renderDesktopDownloadPage({ origin, userAgent, winUrl, macUrl }) {
  const os = detectDesktopOs(userAgent);
  const primaryLabel = os === 'mac' ? 'Pobierz MojaTeczka dla macOS (.dmg)' : 'Pobierz MojaTeczka dla Windows (.exe)';
  const primaryUrl = os === 'mac' ? macUrl : winUrl;
  const secondaryLabel = os === 'mac' ? 'Wersja dla Windows (.exe)' : 'Wersja dla macOS (.dmg)';
  const secondaryUrl = os === 'mac' ? winUrl : macUrl;

  const primaryBlock = primaryUrl
    ? `<p><a class="btn-primary" href="${escapeHtml(primaryUrl)}">${escapeHtml(primaryLabel)}</a></p>`
    : `<p class="notice">Instalator (${escapeHtml(primaryLabel)}) zostanie tutaj podpięty po publikacji paczki. Możesz już zalogować się do swojego konta poniżej.</p>`;

  const secondaryBlock = secondaryUrl
    ? `<p class="alt"><a href="${escapeHtml(secondaryUrl)}">${escapeHtml(secondaryLabel)}</a></p>`
    : '';

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pobierz MojaTeczka na komputer</title>
<link rel="stylesheet" href="/account.css">
</head>
<body>
<main>
  <h1>MojaTeczka na komputer (Windows / macOS)</h1>
  <p>Wykryty system: <strong>${os === 'mac' ? 'macOS' : os === 'win' ? 'Windows' : 'Komputer'}</strong></p>
  ${primaryBlock}
  ${secondaryBlock}
  <h2>Jak połączyć komputer z telefonem (2 kroki)</h2>
  <ol>
    <li>Zainstaluj i uruchom <strong>MojaTeczka</strong> na tym komputerze.</li>
    <li>Zaloguj się na to samo konto albo wybierz <strong>Połącz z urządzeniem mobilnym</strong> i zeskanuj kod QR telefonem.</li>
  </ol>
  <p><a href="${escapeHtml(origin)}/account">Zarządzanie kontem</a> · <a href="${escapeHtml(origin)}/privacy">Polityka prywatności</a></p>
</main>
</body>
</html>`;
}

function buildDesktopDownloadEmail({ pcUrl, winUrl, macUrl }) {
  const lines = [
    'Cześć!',
    '',
    'Oto link do pobrania aplikacji MojaTeczka na komputer:',
    `Strona pobierania (automatycznie wykrywa Windows / macOS): ${pcUrl}`,
  ];
  if (winUrl) lines.push(`Bezpośredni plik Windows (.exe): ${winUrl}`);
  if (macUrl) lines.push(`Bezpośredni plik macOS (.dmg): ${macUrl}`);
  lines.push(
    '',
    'Po zainstalowaniu aplikacji na komputerze zaloguj się na to samo konto lub zeskanuj kod QR telefonem.',
    '',
    'Pozdrawiamy,',
    'Zespół MojaTeczka',
  );
  return {
    subject: 'Link do pobrania MojaTeczka na komputer (Windows / macOS)',
    text: lines.join('\n'),
  };
}

module.exports = {
  resolveDesktopDownloadConfig,
  detectDesktopOs,
  renderDesktopDownloadPage,
  buildDesktopDownloadEmail,
};
