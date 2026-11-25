import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateKey, formatDaysLeftLabel, type ExpiryItem } from '../utils/expiryCalendar';

const PREFS_KEY = 'mojateczka_expiry_notifications_v1';
const LAST_NOTIFIED_KEY = 'mojateczka_expiry_last_notified_day_v1';

export type ExpiryNotificationPrefs = {
  enabled: boolean;
  thresholds: number[]; // days before expiry, e.g. [30, 7, 1, 0]
};

const DEFAULT_PREFS: ExpiryNotificationPrefs = {
  enabled: true,
  thresholds: [30, 7, 1, 0],
};

function loadPrefs(): ExpiryNotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ExpiryNotificationPrefs>;
    const thresholds = Array.isArray(parsed.thresholds)
      ? parsed.thresholds.filter(n => typeof n === 'number' && Number.isFinite(n))
      : DEFAULT_PREFS.thresholds;
    return { enabled: parsed.enabled !== false, thresholds };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function useExpiryNotifications(items: ExpiryItem[]) {
  const [prefs, setPrefs] = useState<ExpiryNotificationPrefs>(loadPrefs);
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  const savePrefs = useCallback((next: ExpiryNotificationPrefs) => {
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore storage errors */ }
  }, []);

  const maxThreshold = useMemo(
    () => (prefs.thresholds.length ? Math.max(...prefs.thresholds) : 0),
    [prefs.thresholds],
  );

  const activeAlerts = useMemo(
    () => items.filter(item => item.source === 'dueDate' && item.daysLeft <= maxThreshold),
    [items, maxThreshold],
  );

  const toggleEnabled = useCallback(async () => {
    const nextEnabled = !prefs.enabled;
    if (nextEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const granted = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
      setPermission(granted);
    }
    savePrefs({ ...prefs, enabled: nextEnabled });
  }, [prefs, savePrefs]);

  const toggleThreshold = useCallback((days: number) => {
    const exists = prefs.thresholds.includes(days);
    const nextThresholds = exists
      ? prefs.thresholds.filter(d => d !== days)
      : [...prefs.thresholds, days].sort((a, b) => b - a);
    savePrefs({ ...prefs, thresholds: nextThresholds });
  }, [prefs, savePrefs]);

  const requestDesktopPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'denied' as NotificationPermission;
    const result = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
    setPermission(result);
    return result;
  }, []);

  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    if (typeof Notification === 'undefined') return false;
    let perm = Notification.permission;
    if (perm === 'default') perm = await requestDesktopPermission();
    if (perm !== 'granted') return false;
    const count = activeAlerts.length;
    const body = count > 0
      ? `Masz ${count} nadchodzących lub przeterminowanych terminów w Kalendarzu ważności.`
      : 'Powiadomienia Kalendarza ważności działają poprawnie. Otrzymasz alert przed końcem polis, przeglądów i gwarancji.';
    new Notification('MojaTeczka — Kalendarz ważności', { body });
    return true;
  }, [activeAlerts.length, requestDesktopPermission]);

  useEffect(() => {
    if (!prefs.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const matching = items.filter(
      item => item.source === 'dueDate' && (item.daysLeft < 0 || prefs.thresholds.includes(item.daysLeft)),
    );
    if (matching.length === 0) return;
    const todayKey = formatDateKey(new Date());
    if (localStorage.getItem(LAST_NOTIFIED_KEY) === todayKey) return;
    localStorage.setItem(LAST_NOTIFIED_KEY, todayKey);
    const first = matching[0];
    const body = matching.length === 1
      ? `${first.doc.title} — ${formatDaysLeftLabel(first.daysLeft)} (${first.date.toLocaleDateString('pl-PL')})`
      : `${first.doc.title} (${formatDaysLeftLabel(first.daysLeft)}) oraz jeszcze ${matching.length - 1} innych terminów.`;
    new Notification('MojaTeczka — Przypomnienie o terminie', { body });
  }, [items, prefs.enabled, prefs.thresholds]);

  return {
    prefs,
    permission,
    activeAlerts,
    toggleEnabled,
    toggleThreshold,
    requestDesktopPermission,
    sendTestNotification,
  };
}
