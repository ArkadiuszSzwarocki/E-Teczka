import { useEffect, useRef, useState } from 'react';
import type { BackupActionCredentials } from '../components/BackupActionDialog';
import type { BackupDestinationChoice } from '../components/BackupDestinationGrid';
import { downloadCloudBackupFile, fetchCloudBackupList, postBackupRestore } from '../services/backupTransferApi';
import { useBackupMfa } from './useBackupMfa';

export type BackupDestination = 'computer' | 'cloud';
export type BackupProvider = 'webdav' | 'google-drive' | 'onedrive' | 'dropbox';
export type BackupSchedule = 'manual' | 'on_login' | 'on_logout';
export type BackupSection = 'settings' | 'send' | 'restore';

export const BACKUP_PROVIDER_LABELS: Record<BackupProvider, string> = {
  webdav: 'Serwer NAS (WebDAV)',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
};

type UseBackupManagerArgs = {
  apiUrl: string;
  fetcher: typeof fetch;
  onDone: (message?: string) => void;
};

/** Encapsulates backup configuration state and orchestrates MFA + cloud/local transfer calls. */
export function useBackupManager({ apiUrl, fetcher: fetch, onDone }: UseBackupManagerArgs) {
  const [destination, setDestination] = useState<BackupDestination>('computer');
  const [provider, setProvider] = useState<BackupProvider>('webdav');
  const [endpoint, setEndpoint] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remoteFolder, setRemoteFolder] = useState('');
  const [schedule, setSchedule] = useState<BackupSchedule>('manual');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [transferMode, setTransferMode] = useState<'send' | 'restore' | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ kind: 'cloud'; filename?: string } | { kind: 'file'; file: File } | null>(null);
  const [cloudBackups, setCloudBackups] = useState<Array<{ name: string; modifiedAt: string | null }> | null>(null);
  const [selectedCloudFilename, setSelectedCloudFilename] = useState<string | undefined>(undefined);
  const [nasType, setNasType] = useState<'qnap' | 'synology' | 'other'>('qnap');
  const [actionDialog, setActionDialog] = useState<'send' | 'restore' | 'list' | null>(null);
  const [cachedNasCredentials, setCachedNasCredentials] = useState<{ username: string; password: string } | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [backupUsername, setBackupUsername] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [useSeparateBackupAccount, setUseSeparateBackupAccount] = useState(false);
  const [backupCredentialSaved, setBackupCredentialSaved] = useState(false);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [lastBackup, setLastBackup] = useState<{ at: string | null; status: string | null; error: string | null } | null>(null);

  const mfa = useBackupMfa(apiUrl, fetch, setMessage);
  const selectedChoice: BackupDestinationChoice = destination === 'computer' ? 'computer' : provider;

  const selectDestinationChoice = (choice: BackupDestinationChoice) => {
    if (choice === 'computer') { setDestination('computer'); return; }
    setDestination('cloud');
    setProvider(choice);
  };

  const finishWithSuccess = (successText: string) => {
    setMessage(successText);
    setCompletedMessage(successText);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onDone(successText);
    }, 2500);
  };

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  const nasEndpoint = () => {
    const value = endpoint.trim();
    if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
    try {
      const url = new URL(`https://${value}`);
      if (!url.port && nasType !== 'other') url.port = nasType === 'qnap' ? '5001' : '5006';
      return url.toString().replace(/\/$/, '');
    } catch {
      return value;
    }
  };

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/backup/destination`, { headers: mfa.authHeaders() })
      .then(async response => {
        if (!response.ok) {
          if (response.status === 402) return null;
          throw new Error('Nie udało się wczytać ustawień kopii.');
        }
        return response.json();
      })
      .then(data => {
        if (!active || !data?.configured) return;
        setDestination('cloud');
        setProvider(data.provider);
        setEndpoint(data.endpoint || '');
        setBackupUsername(data.backupUsername || '');
        setRemoteFolder(data.remoteFolder || '');
        setSchedule(data.schedule === 'on_login' || data.schedule === 'on_logout' ? data.schedule : 'manual');
        setBackupCredentialSaved(Boolean(data.backupCredentialSaved));
        setLastBackup({ at: data.lastBackupAt || null, status: data.lastBackupStatus || null, error: data.lastBackupError || null });
        if (data.endpoint) {
          try {
            const port = new URL(data.endpoint).port;
            setNasType(port === '5001' ? 'qnap' : port === '5006' ? 'synology' : 'other');
          } catch {
            setNasType('other');
          }
        }
      })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Nie udało się wczytać ustawień kopii.'); })
      .finally(() => { if (active) setSettingsLoading(false); });
    return () => { active = false; };
  }, [apiUrl]);

  const restore = async (file: File, authorizedHeaders?: Record<string, string>) => {
    setBusy(true);
    setTransferMode('restore');
    setMessage('Przywracanie kopii…');
    try {
      const protectedHeaders = authorizedHeaders || await mfa.authorize('restore');
      const count = await postBackupRestore(apiUrl, fetch, protectedHeaders, file, recoveryFile, recoveryPassword);
      setMessage(`Przywrócono ${count} dokumentów.`);
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Błąd przywracania kopii.');
    } finally {
      setTransferMode(null);
      setBusy(false);
    }
  };

  const listCloudBackups = async (credentials: BackupActionCredentials) => {
    setBusy(true);
    setMessage('Pobieranie listy kopii…');
    try {
      const protectedHeaders = await mfa.authorize('cloudList', credentials.code);
      const backups = await fetchCloudBackupList(apiUrl, fetch, protectedHeaders, credentials);
      if (provider === 'webdav' && credentials.username && credentials.password) {
        setCachedNasCredentials({ username: credentials.username, password: credentials.password });
      }
      setCloudBackups(backups);
      setMessage('');
    } catch (error) {
      const status = (error as Error & { status?: number })?.status;
      if (status === 401 || status === 502) setCachedNasCredentials(null);
      setMessage(error instanceof Error ? error.message : 'Błąd pobierania listy kopii.');
    } finally {
      setBusy(false);
    }
  };

  const restoreLatestCloud = async (credentials: BackupActionCredentials, requestedFilename?: string) => {
    setBusy(true);
    setTransferMode('restore');
    setMessage(requestedFilename ? `Pobieranie kopii ${requestedFilename}…` : 'Pobieranie najnowszej kopii…');
    try {
      const protectedHeaders = await mfa.authorize('cloudRestore', credentials.code);
      const file = await downloadCloudBackupFile(apiUrl, fetch, protectedHeaders, credentials, requestedFilename);
      await restore(file, protectedHeaders);
    } catch (error) {
      const status = (error as Error & { status?: number })?.status;
      if (provider === 'webdav' && (status === 401 || status === 502)) setCachedNasCredentials(null);
      setTransferMode(null);
      setBusy(false);
      setMessage(error instanceof Error ? error.message : 'Błąd pobierania kopii z chmury.');
    }
  };

  const exportBackup = async () => {
    setBusy(true);
    setMessage('Tworzenie kopii…');
    try {
      const response = await fetch(`${apiUrl}/api/backup/export`, { headers: await mfa.authorize('export') });
      if (!response.ok) throw new Error('Nie udało się utworzyć kopii.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `eteczka-backup-${new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      const successText = 'Lokalna kopia ZIP została utworzona i pobrana.';
      finishWithSuccess(successText);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Błąd tworzenia kopii.');
    } finally {
      setBusy(false);
    }
  };

  const connectOAuth = async (selected: Exclude<BackupProvider, 'webdav'>) => {
    setProvider(selected);
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/backup/oauth/${selected}/start?mode=json`, { headers: await mfa.authorize('connect') });
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error || 'Brak konfiguracji OAuth.');
      window.open(payload.url, '_blank', 'noopener,noreferrer');
      setMessage('Dokończ autoryzację w nowym oknie.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nie udało się połączyć chmury.');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    setMessage('Zapisywanie ustawień…');
    try {
      const headers = await mfa.authorize('send');
      const response = await fetch(`${apiUrl}/api/backup/destination`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          endpoint: provider === 'webdav' ? nasEndpoint() : endpoint,
          remoteFolder,
          schedule,
          username,
          password,
          backupUsername: useSeparateBackupAccount ? backupUsername : '',
          backupPassword: useSeparateBackupAccount ? backupPassword : '',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się zapisać ustawień.');
      if (backupPassword || password) { setBackupCredentialSaved(true); setBackupPassword(''); }
      setMessage('Ustawienia kopii zostały zapisane.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Błąd zapisu ustawień.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (credentials: BackupActionCredentials) => {
    setBusy(true);
    setTransferMode('send');
    setMessage('Wysyłanie kopii…');
    try {
      const protectedHeaders = await mfa.authorize('send', credentials.code);
      const response = await fetch(`${apiUrl}/api/backup/cloud`, {
        method: 'POST',
        headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się wysłać kopii.');
      const target = provider === 'webdav'
        ? `${endpoint.replace(/\/+$/, '')}${remoteFolder ? `/${remoteFolder.replace(/^\/+|\/+$/g, '')}` : ''}`
        : BACKUP_PROVIDER_LABELS[provider];
      const successText = provider === 'webdav'
        ? `Kopia została wyeksportowana na serwer NAS (${target}).`
        : `Kopia została wyeksportowana do ${target}.`;
      finishWithSuccess(successText);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Błąd wysyłki kopii.');
    } finally {
      setTransferMode(null);
      setBusy(false);
    }
  };

  return {
    destination, provider, endpoint, setEndpoint, username, setUsername, password, setPassword,
    remoteFolder, setRemoteFolder, schedule, setSchedule, busy, message, completedMessage, transferMode, sending: transferMode !== null,
    confirmRestore, setConfirmRestore, cloudBackups, selectedCloudFilename, setSelectedCloudFilename,
    nasType, setNasType, actionDialog, setActionDialog, cachedNasCredentials, selectedChoice, selectDestinationChoice,
    mfaEnabled: mfa.mfaEnabled, mfaPromptOpen: mfa.mfaPromptOpen, settingsLoading, backupUsername, setBackupUsername,
    backupPassword, setBackupPassword, useSeparateBackupAccount, setUseSeparateBackupAccount, backupCredentialSaved,
    setRecoveryFile, setRecoveryPassword, lastBackup,
    nasEndpoint, authHeaders: mfa.authHeaders, authorize: mfa.authorize, restore, listCloudBackups,
    restoreLatestCloud, exportBackup, connectOAuth, saveSettings, upload,
    cancelMfaPrompt: mfa.cancelMfaPrompt, submitMfaPrompt: mfa.submitMfaPrompt,
  };
}
