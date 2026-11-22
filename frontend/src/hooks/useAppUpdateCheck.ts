import { useCallback, useEffect, useRef, useState } from 'react';

export type UpdateInfo = {
  version: string;
  builtAt: string;
  currentVersion?: string;
  changes?: string[];
  infoUrl?: string;
};

const JUST_UPDATED_KEY = 'mojateczka_just_updated_info';

/** Polls `/api/app-version` and notifies when a newer build is deployed, allowing user-scheduled reloads. */
export function useAppUpdateCheck(apiUrl: string) {
  const initialVersionRef = useRef<string | null>(null);
  const postponedUntilRef = useRef<number>(0);
  const dismissedSessionRef = useRef<boolean>(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [updatingProgress, setUpdatingProgress] = useState<number | null>(null);
  const [justUpdatedInfo, setJustUpdatedInfo] = useState<UpdateInfo | null>(() => {
    try {
      const raw = sessionStorage.getItem(JUST_UPDATED_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(JUST_UPDATED_KEY);
      return JSON.parse(raw) as UpdateInfo;
    } catch {
      return null;
    }
  });

  const checkNow = useCallback(async () => {
    if (dismissedSessionRef.current) return;
    if (postponedUntilRef.current > Date.now()) return;
    try {
      const res = await fetch(`${apiUrl}/api/app-version`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<UpdateInfo>;
      if (!data.version) return;
      if (!initialVersionRef.current) {
        initialVersionRef.current = data.version;
        return;
      }
      if (data.version !== initialVersionRef.current) {
        setAvailableUpdate({
          version: data.version,
          builtAt: data.builtAt || new Date().toISOString(),
          currentVersion: initialVersionRef.current,
          changes: Array.isArray(data.changes) ? data.changes : undefined,
          infoUrl: typeof data.infoUrl === 'string' ? data.infoUrl : undefined,
        });
      }
    } catch { /* ignore transient offline errors */ }
  }, [apiUrl]);

  useEffect(() => {
    void checkNow();
    const timer = window.setInterval(() => void checkNow(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkNow]);

  const applyUpdateNow = useCallback(async () => {
    if (!availableUpdate) {
      window.location.reload();
      return;
    }
    setUpdatingProgress(15);
    try {
      sessionStorage.setItem(JUST_UPDATED_KEY, JSON.stringify(availableUpdate));
      await fetch('/', { cache: 'reload' }).catch(() => undefined);
      setUpdatingProgress(65);
      await fetch(`${apiUrl}/api/app-version`, { cache: 'no-store' }).catch(() => undefined);
      setUpdatingProgress(100);
    } finally {
      window.setTimeout(() => window.location.reload(), 250);
    }
  }, [apiUrl, availableUpdate]);

  const postponeUpdate = useCallback((minutes: number | 'next_launch') => {
    setAvailableUpdate(null);
    if (minutes === 'next_launch') {
      dismissedSessionRef.current = true;
      return;
    }
    postponedUntilRef.current = Date.now() + minutes * 60_000;
  }, []);

  return {
    availableUpdate,
    updatingProgress,
    justUpdatedInfo,
    dismissJustUpdated: () => setJustUpdatedInfo(null),
    applyUpdateNow,
    postponeUpdate,
  };
}
