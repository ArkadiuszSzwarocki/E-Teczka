import type { BackupActionCredentials } from '../components/BackupActionDialog';

/** Sends a backup file (with optional recovery key) to the restore endpoint. */
export async function postBackupRestore(
  apiUrl: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
  file: File,
  recoveryFile: File | null,
  recoveryPassword: string,
): Promise<number> {
  const body = new FormData();
  body.append('restoreMode', 'replace');
  body.append('backup', file);
  if (recoveryFile) {
    if (recoveryFile.size > 4096) throw new Error('Plik klucza odzyskiwania jest nieprawidłowy.');
    body.append('recoveryKey', await recoveryFile.text());
    body.append('recoveryPassphrase', recoveryPassword);
  }
  const response = await fetcher(`${apiUrl}/api/backup/restore`, { method: 'POST', headers, body });
  const payload = await response.json().catch(() => ({})) as { restoredDocuments?: number; error?: string };
  if (!response.ok) throw new Error(payload.error || 'Nie udało się przywrócić kopii.');
  return payload.restoredDocuments || 0;
}

/** Lists available encrypted backups from cloud/NAS storage. */
export async function fetchCloudBackupList(
  apiUrl: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
  credentials: BackupActionCredentials,
) {
  const response = await fetcher(`${apiUrl}/api/backup/cloud/list`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  const payload = await response.json().catch(() => ({})) as { backups?: Array<{ name: string; modifiedAt: string | null }>; error?: string };
  if (!response.ok) {
    const err = new Error(payload.error || 'Nie udało się pobrać listy kopii.') as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return payload.backups || [];
}

/** Downloads an encrypted backup file from cloud/NAS storage as a File object. */
export async function downloadCloudBackupFile(
  apiUrl: string,
  fetcher: typeof fetch,
  headers: Record<string, string>,
  credentials: BackupActionCredentials,
  requestedFilename?: string,
): Promise<File> {
  const response = await fetcher(`${apiUrl}/api/backup/cloud/latest`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password,
      ...(requestedFilename ? { filename: requestedFilename } : {}),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    const err = new Error(payload.error || 'Nie udało się pobrać kopii z chmury.') as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'mojateczka-cloud-backup.zip.enc';
  return new File([await response.blob()], filename, { type: 'application/octet-stream' });
}
