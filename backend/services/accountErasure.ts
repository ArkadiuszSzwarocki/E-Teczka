import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { securityDir, uploadsDir } from '../config/paths';
import { mailInboxDir } from './mailInboxStore';
import { decrypt, encrypt } from './backupCrypto';
import { centralAccountOrigin } from './centralAccountLink';

function removeFromEncryptedJson(filePath: string, shouldDeleteKey: (key: string) => boolean): void {
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(decrypt(raw)) as Record<string, unknown>;
    let changed = false;
    for (const key of Object.keys(data)) {
      if (shouldDeleteKey(key)) {
        delete data[key];
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(`${filePath}.tmp`, encrypt(JSON.stringify(data)), { mode: 0o600 });
      fs.renameSync(`${filePath}.tmp`, filePath);
    }
  } catch { /* ignore unreadable or missing encrypted stores */ }
}

async function safeExecute(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch { /* ignore when optional runtime table does not exist */ }
}

/**
 * Permanently erases a user account and all of its local database records,
 * uploaded files, vault secrets, and cached security artifacts.
 */
export async function eraseLocalAccountCompletely(
  prisma: PrismaClient,
  userId: number,
  options?: { deleteCentral?: boolean; centralPassword?: string },
): Promise<{ centralDeleted: boolean; centralNote?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) throw new Error('Nie znaleziono konta użytkownika.');

  let centralDeleted = false;
  let centralNote: string | undefined;

  if (options?.deleteCentral) {
    const base = centralAccountOrigin(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
    if (base && options.centralPassword) {
      try {
        const login = await fetch(`${base}/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: user.email, password: options.centralPassword }),
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        });
        if (login.ok) {
          const session = (await login.json()) as { token?: string };
          if (session.token) {
            const del = await fetch(`${base}/delete-account`, {
              method: 'POST',
              headers: { authorization: `Bearer ${session.token}` },
              redirect: 'error',
              signal: AbortSignal.timeout(10000),
            });
            centralDeleted = del.ok;
          }
        } else {
          centralNote = 'Nie udało się potwierdzić hasła na konto.arecki.pl — konto centralne musisz usunąć ręcznie na konto.arecki.pl/account.';
        }
      } catch {
        centralNote = 'Nie udało się połączyć z konto.arecki.pl — konto centralne możesz usunąć ręcznie na konto.arecki.pl/account.';
      }
    } else if (base) {
      centralNote = 'Aby usunąć również globalny login z konto.arecki.pl (np. przy logowaniu Google), użyj przycisku „Usuń konto” na konto.arecki.pl/account.';
    }
  }

  const ownedFolders = await prisma.folder.findMany({ where: { ownerId: userId }, select: { id: true } });
  const folderIds = ownedFolders.map(f => f.id);
  const docs = await prisma.document.findMany({
    where: { OR: [{ userId }, ...(folderIds.length ? [{ folderId: { in: folderIds } }] : [])] },
    select: { id: true, filePath: true },
  });
  const docIds = docs.map(d => d.id);
  const ownerKeys = [`user:${userId}`, `dev-test:user:${userId}`];

  await prisma.$transaction(async tx => {
    if (docIds.length) {
      await tx.documentTag.deleteMany({ where: { documentId: { in: docIds } } });
      await tx.documentLineItem.deleteMany({ where: { documentId: { in: docIds } } });
      await tx.document.deleteMany({ where: { id: { in: docIds } } });
    }
    if (folderIds.length) {
      await tx.folderShare.deleteMany({ where: { folderId: { in: folderIds } } });
      await tx.folder.deleteMany({ where: { id: { in: folderIds } } });
    }
    await tx.folderShare.deleteMany({ where: { userId } });
    await tx.planTagOwner.deleteMany({ where: { ownerId: userId } });
    await tx.planUsage.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.planTrial.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.planPrinterClaim.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.planScanReceipt.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.syncOperation.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.subscription.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.backupDestination.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
    await tx.authSession.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  await safeExecute(() => prisma.$executeRaw`DELETE FROM FamilyMember WHERE userId = ${userId}`);
  await safeExecute(() => prisma.$executeRaw`DELETE FROM FamilyInvite WHERE createdByUserId = ${userId} OR LOWER(email) = ${user.email.trim().toLowerCase()}`);
  await safeExecute(() => prisma.$executeRaw`DELETE FROM FamilyGroup WHERE hostUserId = ${userId}`);
  await safeExecute(() => prisma.$executeRaw`DELETE FROM TesterConsent WHERE userId = ${userId}`);
  await safeExecute(() => prisma.$executeRaw`DELETE FROM CentralAccountLink WHERE localUserId = ${userId}`);

  for (const file of new Set(docs.map(d => d.filePath))) {
    if (!file || path.basename(file) !== file) continue;
    const stillUsed = await prisma.document.count({ where: { filePath: file } });
    if (stillUsed > 0) continue;
    try { await fs.promises.unlink(path.join(uploadsDir, file)); } catch { /* ignore missing files */ }
  }

  const workspaceFile = path.join(securityDir, `archive-workspace-${userId}.json`);
  try { if (fs.existsSync(workspaceFile)) fs.unlinkSync(workspaceFile); } catch { /* ignore */ }
  try { await fs.promises.rm(mailInboxDir(userId), { recursive: true, force: true }); } catch { /* ignore */ }

  for (const encFile of ['folder-vaults.enc', 'folder-vault.enc']) {
    removeFromEncryptedJson(path.join(securityDir, encFile), key => key.startsWith(`${userId}:`));
  }
  for (const encFile of [
    'central-entitlements.enc',
    'central-plan-snapshots.enc',
    'central-plan-journal.enc',
    'backup-mfa.enc',
    'account-login-mfa.enc',
    'hello-credentials.enc',
    'mail-accounts.enc',
    'mail-filters.enc',
    'folder-learning.enc',
  ]) {
    removeFromEncryptedJson(path.join(securityDir, encFile), key => key === String(userId) || key === `user:${userId}`);
  }

  return { centralDeleted, centralNote };
}
