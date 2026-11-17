import { useCallback, useEffect, useRef, useState } from 'react';

export type UpdateInfo = {
  version: string;
  builtAt: string;
};

/** Polls `/api/app-version` and notifies when a newer build is deployed, allowing user-scheduled reloads. */
export function useAppUpdateCheck(apiUrl: string) {
  const initialVersionRef = useRef<string | null>(null);
  const postponedUntilRef = useRef<number>(0);
  const dismissedSessionRef = useRef<boolean>(false);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);

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
        setAvailableUpdate({ version: data.version, builtAt: data.builtAt || new Date().toISOString() });
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

  const applyUpdateNow = useCallback(() => {
    window.location.reload();
  }, []);

  const postponeUpdate = useCallback((minutes: number | 'next_launch') => {
    setAvailableUpdate(null);
    if (minutes === 'next_launch') {
      dismissedSessionRef.current = true;
      return;
    }
    postponedUntilRef.current = Date.now() + minutes * 60_000;
  }, []);

  return { availableUpdate, applyUpdateNow, postponeUpdate };
}
