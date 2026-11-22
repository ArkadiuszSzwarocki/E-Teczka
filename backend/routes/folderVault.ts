import express from 'express';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { PrismaClient } from '@prisma/client';
import { securityDir } from '../config/paths';
import { createFolderVaultStore, type VaultLoginMethod } from '../services/folderVault';

const store = createFolderVaultStore(path.join(securityDir, 'folder-vaults.enc'));

async function sendVaultRecoveryEmail(to: string, code: string) {
  const host = process.env.MOJATECZKA_SMTP_HOST;
  const user = process.env.MOJATECZKA_SMTP_USER;
  const pass = process.env.MOJATECZKA_SMTP_PASSWORD;
  const from = process.env.MOJATECZKA_SMTP_FROM;
  if (!host || !user || !pass || !from) {
    throw new Error('Wysyłka e-mail (SMTP) nie jest skonfigurowana w pliku backend/.env.');
  }
  const port = Number(process.env.MOJATECZKA_SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  await transport.sendMail({
    from,
    to,
    subject: 'E-Teczka Sejf — kod odzyskiwania hasła i PIN-u',
    text: `Kod odzyskiwania sejfu E-Teczki: ${code}\n\nKod jest ważny przez 10 minut.`,
  });
}

/** Per-folder Safe Vault endpoints requiring Password, PIN, Authenticator, and Biometrics. */
export function createFolderVaultRouter(prisma: PrismaClient) {
  const router = express.Router();
  const ownerId = (res: express.Response) => Number(res.locals.userId || 1);

  async function resolveKey(folderIdRaw: string, res: express.Response) {
    const folderId = Number(folderIdRaw);
    if (!Number.isInteger(folderId) || folderId < 1) return null;
    const owner = ownerId(res);
    const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId: owner }, select: { id: true } });
    return folder ? `${owner}:${folder.id}` : null;
  }

  router.get('/:folderId/status', async (req, res) => {
    const key = await resolveKey(req.params.folderId, res);
    if (!key) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    res.json(store.status(key));
  });

  router.post('/:folderId/setup/start', async (req, res) => {
    const key = await resolveKey(req.params.folderId, res);
    if (!key) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(store.startSetup(key));
  });

  router.post('/:folderId/setup/confirm', async (req, res) => {
    const key = await resolveKey(req.params.folderId, res);
    if (!key) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    try {
      const providedEmail = String(req.body?.recoveryEmail || '').trim();
      const user = providedEmail ? null : await prisma.user.findUnique({ where: { id: ownerId(res) }, select: { email: true } });
      const result = store.confirmSetup(key, {
        password: String(req.body?.password || ''),
        pin: String(req.body?.pin || ''),
        totpCode: String(req.body?.totpCode || ''),
        loginMethod: String(req.body?.loginMethod || '') as VaultLoginMethod,
        biometricEnabled: Boolean(req.body?.biometricEnabled),
        recoveryEmail: providedEmail || user?.email || '',
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Nie udało się zapisać sejfu.' });
    }
  });

  router.post('/:folderId/unlock', async (req, res) => {
    const key = await resolveKey(req.params.folderId, res);
    if (!key) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    try {
      res.json(store.unlock(key, {
        secret: typeof req.body?.secret === 'string' ? req.body.secret : undefined,
        biometricVerified: Boolean(req.body?.biometricVerified),
        totpCode: String(req.body?.totpCode || ''),
      }));
    } catch (e) {
      res.status(401).json({ error: e instanceof Error ? e.message : 'Nie udało się odblokować sejfu.' });
    }
  });

  router.post('/:folderId/recovery/request', async (req, res) => {
    const key = await resolveKey(req.params.folderId, res);
    if (!key) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    try {
      const result = await store.requestRecovery(key, String(req.body?.totpCode || ''), sendVaultRecoveryEmail);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Nie udało się wysłać kodu na e-mail.' });
    }
  });

  router.post('/:folderId/recovery/complete', async (req, res) => {
    const key = await resolveKey(req.params.folderId, res);
    if (!key) return res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
    try {
      res.json(store.completeRecovery(key, {
        emailCode: String(req.body?.emailCode || ''),
        totpCode: String(req.body?.totpCode || ''),
        newPassword: String(req.body?.newPassword || ''),
        newPin: String(req.body?.newPin || ''),
      }));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Nie udało się zmienić hasła i PIN-u sejfu.' });
    }
  });

  return router;
}
