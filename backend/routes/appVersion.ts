import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const processStartedAt = new Date().toISOString();

function readCurrentBuildInfo(): { version: string; builtAt: string; changes: string[]; infoUrl: string } {
  const pkgPath = path.resolve(__dirname, '../package.json');
  const distIndexPath = path.resolve(__dirname, '../../frontend/dist/index.html');
  let pkgVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (pkg.version) pkgVersion = pkg.version;
  } catch { /* keep fallback */ }

  let builtAt = processStartedAt;
  let buildStamp = processStartedAt;
  try {
    if (fs.existsSync(distIndexPath)) {
      const stat = fs.statSync(distIndexPath);
      builtAt = stat.mtime.toISOString();
      buildStamp = String(Math.round(stat.mtimeMs));
    }
  } catch { /* keep process start timestamp */ }

  return {
    version: `${pkgVersion}-${buildStamp}`,
    builtAt,
    changes: [
      'Poprawki stabilności synchronizacji i wgrywania dokumentów.',
      'Usprawnienia interfejsu, skali aplikacji oraz zgłaszania uwag.',
      'Aktualizacje bezpieczeństwa logowania i sesji.',
    ],
    infoUrl: 'https://konto.arecki.pl',
  };
}

/** Exposes the active server & frontend build version so clients can prompt users before updating. */
export function createAppVersionRouter() {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(readCurrentBuildInfo());
  });

  return router;
}
