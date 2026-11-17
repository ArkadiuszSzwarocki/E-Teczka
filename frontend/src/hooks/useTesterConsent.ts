import { useCallback, useEffect, useState } from 'react';
import { hasActiveDiskPermission, requestSavedDiskPermission, pickTesterDiskDirectory } from '../services/localTesterStore';
import { errorMessage } from '../utils/errors';

export type TesterStorageMode = 'local_disk' | 'local_browser' | 'qnap_server';

type ConsentState = {
  required: boolean;
  needsConsent?: boolean;
  consent: {
    accepted: boolean;
    storageMode: TesterStorageMode;
    policyVersion: string;
    acceptedAt: string;
  } | null;
};

/** Loads and records public-test privacy & disk storage consent on the QNAP server. */
export function useTesterConsent(apiUrl: string, fetcher: typeof fetch, userEmail: string | null) {
  const isAuthenticated = Boolean(userEmail);
  const [state, setState] = useState<ConsentState | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [diskReconnect, setDiskReconnect] = useState<{ needed: boolean; folderName: string | null }>({ needed: false, folderName: null });

  const checkDisk = useCallback(async (email: string | null, mode: TesterStorageMode) => {
    if (!email || mode !== 'local_disk') { setDiskReconnect({ needed: false, folderName: null }); return; }
    const status = await hasActiveDiskPermission(email);
    setDiskReconnect({ needed: !status.hasHandle || !status.granted, folderName: status.folderName });
  }, []);

  const load = useCallback(async () => {
    if (!isAuthenticated) { setState(null); setDiskReconnect({ needed: false, folderName: null }); return; }
    setChecking(true);
    setError('');
    try {
      const res = await fetcher(`${apiUrl}/api/tester-consent`);
      if (!res.ok) throw new Error();
      const loaded = (await res.json()) as ConsentState;
      setState(loaded);
      const effectiveMode: TesterStorageMode = loaded.required && loaded.consent?.accepted ? loaded.consent.storageMode : 'qnap_server';
      await checkDisk(userEmail, effectiveMode);
    } catch {
      setState(null);
    } finally {
      setChecking(false);
    }
  }, [apiUrl, fetcher, isAuthenticated, userEmail, checkDisk]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitConsent = async (accepted: boolean, storageMode: TesterStorageMode): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const res = await fetcher(`${apiUrl}/api/tester-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted, storageMode }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Nie udało się zapisać zgody.');
      setState(prev => ({ required: prev?.required ?? true, needsConsent: !accepted || storageMode === 'local_browser', consent: payload.consent }));
      await checkDisk(userEmail, storageMode);
      return true;
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się zapisać zgody.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reconnectDisk = async (): Promise<boolean> => {
    if (!userEmail) return false;
    setBusy(true);
    setError('');
    try {
      const status = await hasActiveDiskPermission(userEmail);
      const ok = status.hasHandle ? await requestSavedDiskPermission(userEmail) : Boolean(await pickTesterDiskDirectory(userEmail));
      await checkDisk(userEmail, 'local_disk');
      return ok;
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się otworzyć folderu na dysku.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const needsConsent = Boolean(
    isAuthenticated
    && state?.required
    && (state.needsConsent ?? (!state.consent || !state.consent.accepted || state.consent.storageMode === 'local_browser')),
  );
  const storageMode: TesterStorageMode = state?.required && state?.consent?.accepted
    ? state.consent.storageMode
    : 'qnap_server';

  return { checking, needsConsent, storageMode, diskReconnect, reconnectDisk, busy, error, submitConsent };
}
