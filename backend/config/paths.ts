import fs from 'fs';
import path from 'path';

/** Centralna konfiguracja katalogów danych lokalnej E‑Teczki. */
export const uploadsDir = path.join(process.cwd(), 'uploads');
export const scanDraftsDir = path.join(uploadsDir, '.scan-drafts');
export const securityDir = path.join(process.cwd(), 'security');
export const pairedDevicesFile = path.join(securityDir, 'paired-devices.json');

for (const directory of [uploadsDir, scanDraftsDir, securityDir]) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}
