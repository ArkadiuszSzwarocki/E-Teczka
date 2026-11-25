import type { ExpiryNotificationPrefs } from '../hooks/useExpiryNotifications';
import type { ExpiryItem } from '../utils/expiryCalendar';
import { formatDaysLeftLabel, urgencyBadgeTone } from '../utils/expiryCalendar';

const THRESHOLD_OPTIONS = [
  { days: 30, label: '30 dni przed' },
  { days: 7, label: '7 dni przed' },
  { days: 1, label: '1 dzień przed' },
  { days: 0, label: 'W dniu terminu' },
];

type Props = {
  prefs: ExpiryNotificationPrefs;
  permission: NotificationPermission;
  activeAlerts: ExpiryItem[];
  onToggleEnabled: () => void;
  onToggleThreshold: (days: number) => void;
  onRequestPermission: () => void;
  onSendTest: () => void;
  onOpenDocument: (item: ExpiryItem) => void;
};

/** Notification preferences and active upcoming-deadline alerts banner for Expiry Calendar. */
export default function ExpiryNotificationPanel({
  prefs,
  permission,
  activeAlerts,
  onToggleEnabled,
  onToggleThreshold,
  onRequestPermission,
  onSendTest,
  onOpenDocument,
}: Props) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#111c33]/85 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🔔</span>
          <div>
            <p className="text-sm font-bold text-white">Powiadomienia o terminach</p>
            <p className="text-xs text-slate-400">
              Przypomnienia na komputerze i w aplikacji przed końcem polisy, przeglądu, płatności lub gwarancji.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleEnabled}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${prefs.enabled ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            {prefs.enabled ? '✓ Powiadomienia włączone' : 'Powiadomienia wyłączone'}
          </button>
          {prefs.enabled && permission !== 'granted' && (
            <button
              type="button"
              onClick={onRequestPermission}
              className="rounded-lg border border-amber-500/60 bg-amber-950/50 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-900/60"
            >
              Zezwól na powiadomienia systemowe
            </button>
          )}
          <button
            type="button"
            onClick={onSendTest}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            🔔 Wyślij test
          </button>
        </div>
      </div>

      {prefs.enabled && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-700/70 pt-3">
          <span className="text-xs font-semibold text-slate-400">Przypomnij:</span>
          {THRESHOLD_OPTIONS.map(opt => {
            const active = prefs.thresholds.includes(opt.days);
            return (
              <button
                key={opt.days}
                type="button"
                onClick={() => onToggleThreshold(opt.days)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                  active
                    ? 'border-cyan-500/70 bg-cyan-950/60 text-cyan-200'
                    : 'border-slate-700 bg-slate-800/70 text-slate-400 hover:text-slate-200'
                }`}
              >
                {active ? '✓ ' : ''}{opt.label}
              </button>
            );
          })}
        </div>
      )}

      {prefs.enabled && activeAlerts.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-slate-700/70 pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300">
            Aktywne alerty ({activeAlerts.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {activeAlerts.slice(0, 6).map(item => (
              <button
                key={item.doc.id}
                type="button"
                onClick={() => onOpenDocument(item)}
                className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition hover:brightness-110 ${urgencyBadgeTone(item.daysLeft)}`}
              >
                <span className="max-w-44 truncate">{item.doc.title}</span>
                <span className="font-extrabold">· {formatDaysLeftLabel(item.daysLeft)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
