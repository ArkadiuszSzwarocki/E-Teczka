import type { PrismaClient } from '@prisma/client';
import { exportFolderLearning, importFolderLearning } from './folderLearningStore';
import { getMailAccounts, getMailFilters, getPublicMailAccounts, restoreMailFilters, upsertMailAccount } from './mailInboxStore';
import { getWatchFolderConfig, saveWatchFolderConfig } from './watchFolderService';

export type SystemSettingsBackup = {
  version: 1;
  kind: 'eteczka-settings-backup';
  exportedAt: string;
  mailAccounts: Array<{
    id: string;
    label: string;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    mailbox: string;
  }>;
  mailFilters: ReturnType<typeof getMailFilters>;
  folderLearning: ReturnType<typeof exportFolderLearning>;
  watchFolder: ReturnType<typeof getWatchFolderConfig>;
  backupDestination: {
    provider: string;
    endpoint: string | null;
    remoteFolder: string | null;
    schedule: string | null;
    enabled: boolean;
  } | null;
  folders: Array<{ id: number; name: string; parentId: number | null }>;
  clientPreferences?: Record<string, string>;
};

/** Exports all non-secret system settings, mailbox metadata (without passwords), rules, and learned signatures. */
export async function exportSystemSettings(
  prisma: PrismaClient,
  ownerId: number,
  ownerKey: string,
): Promise<SystemSettingsBackup> {
  const [folders, backupDest] = await Promise.all([
    prisma.folder.findMany({
      where: { ownerId },
      select: { id: true, name: true, parentId: true },
    }),
    prisma.backupDestination.findUnique({
      where: { ownerKey },
      select: { provider: true, endpoint: true, remoteFolder: true, schedule: true, enabled: true },
    }),
  ]);

  return {
    version: 1,
    kind: 'eteczka-settings-backup',
    exportedAt: new Date().toISOString(),
    mailAccounts: getPublicMailAccounts(ownerId),
    mailFilters: getMailFilters(ownerId),
    folderLearning: exportFolderLearning(ownerId),
    watchFolder: getWatchFolderConfig(ownerId),
    backupDestination: backupDest ?? null,
    folders,
  };
}

/** Restores non-secret system settings, mailbox definitions (preserving existing passwords), filters, and learned rules. */
export async function restoreSystemSettings(
  prisma: PrismaClient,
  ownerId: number,
  ownerKey: string,
  rawPayload: unknown,
) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new Error('Nieprawidłowy format pliku kopii ustawień.');
  }
  const payload = rawPayload as Partial<SystemSettingsBackup>;
  if (payload.version !== 1 || payload.kind !== 'eteczka-settings-backup') {
    throw new Error('Ten plik nie jest prawidłową kopią ustawień E‑Teczki (wersja 1).');
  }

  const currentFolders = await prisma.folder.findMany({
    where: { ownerId },
    select: { id: true, name: true },
  });
  const validFolderIds = new Set(currentFolders.map(f => f.id));
  const folderIdByName = new Map(currentFolders.map(f => [f.name.trim().toLowerCase(), f.id]));
  const exportedFolderNameById = new Map((payload.folders || []).map(f => [f.id, f.name.trim().toLowerCase()]));

  const resolveFolderId = (oldId: number): number | null => {
    if (validFolderIds.has(oldId)) return oldId;
    const oldName = exportedFolderNameById.get(oldId);
    if (!oldName) return null;
    return folderIdByName.get(oldName) ?? null;
  };

  let mailAccountsRestored = 0;
  const existingAccounts = getMailAccounts(ownerId);
  for (const acc of payload.mailAccounts || []) {
    if (!acc || typeof acc.user !== 'string' || typeof acc.host !== 'string') continue;
    const match = existingAccounts.find(e => e.id === acc.id || e.user.toLowerCase() === acc.user.toLowerCase());
    upsertMailAccount(ownerId, {
      id: match?.id || acc.id || acc.user.toLowerCase(),
      label: String(acc.label || acc.user).slice(0, 120),
      host: acc.host.trim(),
      port: Number.isInteger(Number(acc.port)) ? Number(acc.port) : 993,
      secure: acc.secure !== false,
      user: acc.user.trim(),
      password: match?.password || '',
      mailbox: String(acc.mailbox || 'INBOX').trim() || 'INBOX',
    });
    mailAccountsRestored++;
  }

  const mappedSenderRules: Record<string, number> = {};
  for (const [email, oldFolderId] of Object.entries(payload.mailFilters?.senderFolderRules || {})) {
    const targetId = resolveFolderId(Number(oldFolderId));
    if (targetId) mappedSenderRules[email] = targetId;
  }

  const restoredFilters = restoreMailFilters(ownerId, {
    excludedSenders: Array.isArray(payload.mailFilters?.excludedSenders) ? payload.mailFilters.excludedSenders : [],
    knownSenders: Array.isArray(payload.mailFilters?.knownSenders) ? payload.mailFilters.knownSenders : [],
    syncCursors: payload.mailFilters?.syncCursors || {},
    processedKeys: Array.isArray(payload.mailFilters?.processedKeys) ? payload.mailFilters.processedKeys : [],
    senderFolderRules: mappedSenderRules,
  });

  const mappedLearning: ReturnType<typeof exportFolderLearning> = {};
  for (const [sigKey, entry] of Object.entries(payload.folderLearning || {})) {
    if (!entry) continue;
    const targetId = resolveFolderId(Number(entry.folderId));
    if (targetId) {
      mappedLearning[sigKey] = { ...entry, folderId: targetId };
    }
  }
  const learnedSignaturesCount = importFolderLearning(ownerId, mappedLearning);

  let watchFolderRestored = false;
  if (payload.watchFolder && typeof payload.watchFolder.folderPath === 'string' && payload.watchFolder.folderPath.trim()) {
    try {
      saveWatchFolderConfig(ownerId, {
        folderPath: payload.watchFolder.folderPath,
        enabled: Boolean(payload.watchFolder.enabled),
      });
      watchFolderRestored = true;
    } catch {
      watchFolderRestored = false;
    }
  }

  let backupDestinationRestored = false;
  if (payload.backupDestination && typeof payload.backupDestination.provider === 'string') {
    const dest = payload.backupDestination;
    await prisma.backupDestination.upsert({
      where: { ownerKey },
      create: {
        ownerKey,
        provider: dest.provider,
        endpoint: dest.endpoint,
        remoteFolder: dest.remoteFolder,
        schedule: dest.schedule || 'manual',
        enabled: Boolean(dest.enabled),
      },
      update: {
        provider: dest.provider,
        endpoint: dest.endpoint,
        remoteFolder: dest.remoteFolder,
        schedule: dest.schedule || 'manual',
        enabled: Boolean(dest.enabled),
      },
    });
    backupDestinationRestored = true;
  }

  return {
    mailAccountsRestored,
    excludedSendersCount: restoredFilters.excludedSenders.length,
    senderRulesCount: Object.keys(mappedSenderRules).length,
    learnedSignaturesCount,
    watchFolderRestored,
    backupDestinationRestored,
  };
}
