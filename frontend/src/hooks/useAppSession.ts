import { useCallback, useEffect, useState } from 'react';
import { getElectronIpc } from '../services/electron';

export type AuthUser = { name?: string | null; email: string };
export type AutoBackupStatus = { stage: 'sending' | 'done' | 'error'; message: string } | null;

type Args = {
  apiUrl: string;
  fetcher: typeof fetch;
  fetchData: () => Promise<void>;
  onResetWorkspace: () => void;
  showToast: (message: string, type?: string) => void;
};

/** Manages account session restoration, login/logout transitions, Electron quit hooks, and auto-backup status. */
export function useAppSession({ apiUrl, fetcher, fetchData, onResetWorkspace, showToast }: Args) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('eteczka_auth_token'));
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [autoBackupStatus, setAutoBackupStatus] = useState<AutoBackupStatus>(null);

  const runAutoBackup = useCallback(async (trigger: 'on_login' | 'on_logout') => {
    try {
      const destRes = await fetcher(`${apiUrl}/api/backup/destination`);
      if (!destRes.ok) return;
      const dest = await destRes.json().catch(() => null) as { configured?: boolean; schedule?: string } | null;
      if (!dest?.configured || dest.schedule !== trigger) return;
      setAutoBackupStatus({
        stage: 'sending',
        message: trigger === 'on_login' ? 'Wysyłanie kopii zapasowej przy logowaniu…' : 'Wysyłanie kopii zapasowej przed wylogowaniem…',
      });
      const uploadRes = await fetcher(`${apiUrl}/api/backup/cloud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto: true }),
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({})) as { error?: string };
        const msg = err.error || 'Nie udało się wysłać automatycznej kopii.';
        setAutoBackupStatus({ stage: 'error', message: msg });
        showToast(msg, 'error');
      } else {
        setAutoBackupStatus({ stage: 'done', message: 'Kopia zapasowa została wysłana.' });
      }
      await new Promise(resolve => setTimeout(resolve, trigger === 'on_logout' ? 1000 : 2500));
      setAutoBackupStatus(null);
    } catch {
      setAutoBackupStatus(null);
    }
  }, [apiUrl, fetcher, showToast]);

  const handleAuthenticated = useCallback((user: AuthUser) => {
    onResetWorkspace();
    setCurrentUser(user);
    setIsAuthOpen(false);
    setIsUserMenuOpen(false);
    showToast(`Zalogowano jako ${user.email}.`, 'success');
    void fetchData();
    void runAutoBackup('on_login');
  }, [fetchData, onResetWorkspace, runAutoBackup, showToast]);

  useEffect(() => {
    const ipc = getElectronIpc();
    if (!ipc) return;
    const onPrepareQuit = () => {
      void runAutoBackup('on_logout').finally(() => {
        void ipc.invoke('eteczka-quit-ready').catch(() => undefined);
      });
    };
    const onConfirmClose = () => setIsCloseModalOpen(true);
    ipc.on('eteczka-prepare-quit', onPrepareQuit);
    ipc.on('eteczka-confirm-close', onConfirmClose);
    return () => {
      ipc.removeListener('eteczka-prepare-quit', onPrepareQuit);
      ipc.removeListener('eteczka-confirm-close', onConfirmClose);
    };
  }, [runAutoBackup]);

  useEffect(() => {
    const token = localStorage.getItem('eteczka_auth_token');
    if (!token) return;
    let active = true;
    void fetcher(`${apiUrl}/api/auth/me`)
      .then(async response => {
        if (response.status === 401) {
          if (localStorage.getItem('eteczka_auth_token') === token) localStorage.removeItem('eteczka_auth_token');
          return null;
        }
        return response.ok ? response.json() : null;
      })
      .then(user => {
        if (active && localStorage.getItem('eteczka_auth_token') === token && user && typeof user.email === 'string') {
          setCurrentUser(user);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [apiUrl, fetcher]);

  const logoutAccount = useCallback(async () => {
    await runAutoBackup('on_logout');
    try {
      await fetcher(`${apiUrl}/api/auth/logout`, { method: 'POST' });
    } catch { /* Local sign-out remains possible when the server is unavailable. */ } finally {
      localStorage.removeItem('eteczka_auth_token');
      window.dispatchEvent(new Event('eteczka-auth-changed'));
      setCurrentUser(null);
      setIsUserMenuOpen(false);
      onResetWorkspace();
    }
  }, [apiUrl, fetcher, onResetWorkspace, runAutoBackup]);

  return {
    currentUser,
    isAuthOpen, setIsAuthOpen,
    showWelcome, setShowWelcome,
    isUserMenuOpen, setIsUserMenuOpen,
    isCloseModalOpen, setIsCloseModalOpen,
    autoBackupStatus,
    handleAuthenticated,
    logoutAccount,
  };
}
