import crypto from 'crypto';
import fs from 'fs';
import { securityDir } from '../config/paths';
import path from 'path';

const secretFile = path.join(securityDir, 'auth-secret');

export function authSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {}
  const generated = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}
