import { useMemo, useState } from 'react';
import type { DocumentRecord } from '../types/domain';
import { downloadIcsFile } from '../utils/icsCalendar';
import {
  buildExpiryItems,
  CATEGORY_TABS,
  filterExpiryItems,
  formatDateKey,
  formatDaysLeftLabel,
  URGENCY_OPTIONS,
  urgencyBadgeTone,
  type ExpiryCategory,
  type ExpiryItem,
  type ExpiryUrgency,
} from '../utils/expiryCalendar';
import { useExpiryNotifications } from '../hooks/useExpiryNotifications';
import ExpiryCalendarGrid from './ExpiryCalendarGrid';
import ExpiryNotificationPanel from './ExpiryNotificationPanel';
import EmergencyKitCard from './EmergencyKitCard';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
  onRefreshData?: () => Promise<void>;
  showToast?: (message: string, type?: string) => void;
};

/** Visual Expiry Calendar ("Kalendarz ważności") with month grid, filters, OCR date scan, and notifications. */
export default function ExpiryCalendarView({
  apiUrl,
  fetcher,
  documents,
  onOpenDocument,
  onRefreshData,
  showToast,
}: Props) {
  const now = new Date();
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(formatDateKey(now));
  const [category, setCategory] = useState<ExpiryCategory>('all');
  const [urgency, setUrgency] = useState<ExpiryUrgency>('all');
  const [query, setQuery] = useState('');
  const [includeRetention, setIncludeRetention] = useState(false);
  const [scanningOcr, setScanningOcr] = useState(false);

  const allItems = useMemo(
    () => buildExpiryItems(documents, includeRetention),
    [documents, includeRetention],
  );
  const realDueCount = useMemo(
    () => documents.filter(d => !d.isDeleted && !d.isArchived && Boolean(d.dueDate)).length,
    [documents],
  );
  const filteredItems = useMemo(
    () => filterExpiryItems(allItems, { category, urgency, query }),
    [allItems, category, urgency, query],
  );

  const notifications = useExpiryNotifications(allItems);

  const overdue = filteredItems.filter(i => i.daysLeft < 0);
  const urgent = filteredItems.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7);
  const upcoming = filteredItems.filter(i => i.daysLeft > 7 && i.daysLeft <= 30);
  const later = filteredItems.filter(i => i.daysLeft > 30);

  const handleBackfillOcr = async () => {
    setScanningOcr(true);
    try {
      const res = await fetcher(`${apiUrl}/api/documents/backfill-expiries`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { scanned?: number; updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error || 'Nie udało się przeskanować terminów z OCR.');
      await onRefreshData?.();
      showToast?.(
        data.updated && data.updated > 0
          ? `Wykryto ${data.updated} nowych terminów z OCR (przeskanowano ${data.scanned ?? 0} dokumentów).`
          : `Przeskanowano ${data.scanned ?? 0} dokumentów z OCR — nie znaleziono nowych dat ważności.`,
        'success',
      );
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : 'Błąd skanowania terminów.', 'error');
    } finally {
      setScanningOcr(false);
    }
  };

  const handleSendTest = async () => {
    const ok = await notifications.sendTestNotification();
    showToast?.(
      ok
        ? 'Wysłano testowe powiadomienie systemowe.'
        : 'Zezwól na powiadomienia w ustawieniach systemu/przeglądarki, aby otrzymywać alerty.',
      ok ? 'success' : 'error',
    );
  };

  const jumpNearestEvent = () => {
    const target = filteredItems.find(i => i.daysLeft >= 0) || filteredItems[0];
    if (!target) return;
    setYear(target.date.getFullYear());
    setMonth(target.date.getMonth());
    setSelectedDateKey(target.dateKey);
  };

  const renderGroup = (heading: string, list: ExpiryItem[], toneClass: string) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-2">
        <h4 className={`text-xs font-bold uppercase tracking-wider ${toneClass}`}>{heading} ({list.length})</h4>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {list.map(item => (
            <button
              key={item.doc.id}
              type="button"
              onClick={() => onOpenDocument(item.doc)}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#111c33]/90 p-3.5 text-left transition hover:border-blue-400/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                  <span>{item.categoryLabel}</span>
                  {item.source === 'retention' && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">Retencja</span>
                  )}
                </div>
                <p className="truncate text-sm font-bold text-white">{item.doc.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">Termin: {item.date.toLocaleDateString('pl-PL')}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-extrabold ${urgencyBadgeTone(item.daysLeft)}`}>
                {formatDaysLeftLabel(item.daysLeft)}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-white">🗓️ Kalendarz ważności</h3>
          <p className="mt-1 text-xs text-slate-400">
            Strażnik polis OC/AC, przeglądów auta, ważności dokumentów, płatności i gwarancji.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${viewMode === 'calendar' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              📅 Kalendarz
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              📋 Lista
            </button>
          </div>
          <button
            type="button"
            disabled={scanningOcr}
            onClick={() => void handleBackfillOcr()}
            title="Przeskanuj zapisany tekst OCR istniejących dokumentów, aby automatycznie uzupełnić brakujące daty ważności"
            className="rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-50"
          >
            {scanningOcr ? 'Skanowanie OCR…' : '🔍 Wykryj terminy z OCR'}
          </button>
          {filteredItems.length > 0 && (
            <button
              type="button"
              onClick={() => downloadIcsFile('MojaTeczka-terminy.ics', filteredItems.map(i => ({ uid: `doc-${i.doc.id}`, title: `${i.categoryLabel}: ${i.doc.title}`, date: i.date })))}
              className="rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-600/35"
            >
              📥 Eksport (.ics)
            </button>
          )}
        </div>
      </div>

      <ExpiryNotificationPanel
        prefs={notifications.prefs}
        permission={notifications.permission}
        activeAlerts={notifications.activeAlerts}
        onToggleEnabled={() => void notifications.toggleEnabled()}
        onToggleThreshold={notifications.toggleThreshold}
        onRequestPermission={() => void notifications.requestDesktopPermission()}
        onSendTest={() => void handleSendTest()}
        onOpenDocument={item => onOpenDocument(item.doc)}
      />

      <div className="space-y-3 rounded-2xl border border-slate-700 bg-[#111c33]/80 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filtruj po nazwie dokumentu lub sprzedawcy…"
            className="min-w-56 flex-1 rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <select
            value={urgency}
            onChange={e => setUrgency(e.target.value as ExpiryUrgency)}
            aria-label="Filtr pilności"
            className="rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-1.5 text-xs font-semibold text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            {URGENCY_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-[#0f172a] px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500">
            <input
              type="checkbox"
              checked={includeRetention}
              onChange={e => setIncludeRetention(e.target.checked)}
              className="h-3.5 w-3.5 accent-blue-500"
            />
            <span>Pokaż też retencję archiwum (domyślne 5 lat)</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORY_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCategory(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${category === t.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {realDueCount === 0 && !includeRetention && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4 text-xs leading-relaxed text-amber-100">
          <p className="font-bold text-amber-200">ℹ️ Dlaczego lista jest pusta lub wcześniej wszystkie dokumenty miały tę samą datę?</p>
          <p className="mt-1">
            Wcześniej kalendarz pokazywał domyślną 5-letnią retencję archiwum (liczoną od dnia wgrania pliku), dlatego wszystkie dokumenty dodane tego samego dnia miały identyczną datę.
            Teraz kalendarz domyślnie pokazuje <strong>prawdziwe terminy ważności i płatności</strong>. Kliknij <strong>„🔍 Wykryj terminy z OCR”</strong>, ustaw termin w dokumencie albo zaznacz opcję <em>„Pokaż też retencję archiwum”</em>.
          </p>
        </div>
      )}

      {viewMode === 'calendar' ? (
        <ExpiryCalendarGrid
          year={year}
          month={month}
          items={filteredItems}
          selectedDateKey={selectedDateKey}
          onSelectDateKey={setSelectedDateKey}
          onChangeMonth={(nextYear, nextMonth) => { setYear(nextYear); setMonth(nextMonth); }}
          onJumpToday={() => {
            const today = new Date();
            setYear(today.getFullYear());
            setMonth(today.getMonth());
            setSelectedDateKey(formatDateKey(today));
          }}
          onJumpNearestEvent={jumpNearestEvent}
          onOpenDocument={onOpenDocument}
        />
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-[#111c33]/60 p-8 text-center text-sm text-slate-400">
          Brak dokumentów spełniających wybrane filtry.
        </div>
      ) : (
        <div className="space-y-6">
          {renderGroup('Po terminie', overdue, 'text-red-400')}
          {renderGroup('Pilne (do 7 dni)', urgent, 'text-amber-300')}
          {renderGroup('Nadchodzące (do 30 dni)', upcoming, 'text-blue-300')}
          {renderGroup('Dalsze terminy', later, 'text-slate-400')}
        </div>
      )}

      <EmergencyKitCard apiUrl={apiUrl} fetcher={fetcher} />
    </section>
  );
}
