import fs from 'fs';
import path from 'path';

/** Centralna konfiguracja katalogów danych lokalnej E‑Teczki. */
export const dataRoot = process.env.MOJATECZKA_DATA_DIR?.trim() ? path.resolve(process.env.MOJATECZKA_DATA_DIR.trim()) : process.cwd();
export const uploadsDir = path.join(dataRoot, 'uploads');
export const scanDraftsDir = path.join(uploadsDir, '.scan-drafts');
export const securityDir = path.join(dataRoot, 'security');
export const pairedDevicesFile = path.join(securityDir, 'paired-devices.json');

for (const directory of [uploadsDir, scanDraftsDir, securityDir]) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}
