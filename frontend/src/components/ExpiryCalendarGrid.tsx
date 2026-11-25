import { useMemo, useState } from 'react';
import type { DocumentRecord } from '../types/domain';
import {
  buildMonthGrid,
  formatDaysLeftLabel,
  POLISH_MONTHS,
  POLISH_WEEKDAYS_SHORT,
  urgencyBadgeTone,
  type ExpiryItem,
} from '../utils/expiryCalendar';

type Props = {
  year: number;
  month: number;
  items: ExpiryItem[];
  allDocuments?: DocumentRecord[];
  selectedDateKey: string | null;
  onSelectDateKey: (dateKey: string) => void;
  onChangeMonth: (year: number, month: number) => void;
  onJumpToday: () => void;
  onJumpNearestEvent: () => void;
  onOpenDocument: (doc: DocumentRecord) => void;
  onAssignDate?: (docId: number, dateKey: string) => Promise<void>;
  onMarkPaid?: (docId: number) => Promise<void>;
};

/** Interactive monthly calendar grid (Mon–Sun) displaying document deadlines with day details. */
export default function ExpiryCalendarGrid({
  year,
  month,
  items,
  allDocuments = [],
  selectedDateKey,
  onSelectDateKey,
  onChangeMonth,
  onJumpToday,
  onJumpNearestEvent,
  onOpenDocument,
  onAssignDate,
  onMarkPaid,
}: Props) {
  const [assignDocId, setAssignDocId] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [payingDocId, setPayingDocId] = useState<number | null>(null);
  const assignableDocs = useMemo(
    () => allDocuments.filter(d => !d.isDeleted && !d.isArchived && !d.readOnly),
    [allDocuments],
  );
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ExpiryItem[]>();
    for (const item of items) {
      const list = map.get(item.dateKey) || [];
      list.push(item);
      map.set(item.dateKey, list);
    }
    return map;
  }, [items]);

  const monthEventCount = useMemo(
    () => items.filter(i => i.date.getFullYear() === year && i.date.getMonth() === month).length,
    [items, year, month],
  );

  const selectedItems = selectedDateKey ? (itemsByDate.get(selectedDateKey) || []) : [];

  const goPrev = () => {
    if (month === 0) onChangeMonth(year - 1, 11);
    else onChangeMonth(year, month - 1);
  };

  const goNext = () => {
    if (month === 11) onChangeMonth(year + 1, 0);
    else onChangeMonth(year, month + 1);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-700 bg-[#111c33]/90 p-4 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">
              ‹ Poprzedni
            </button>
            <h4 className="min-w-44 text-center text-base font-bold text-white">
              {POLISH_MONTHS[month]} {year}
            </h4>
            <button type="button" onClick={goNext} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700">
              Następny ›
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">
              W tym miesiącu: <strong className="text-white">{monthEventCount}</strong>
            </span>
            <button type="button" onClick={onJumpToday} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              Dziś
            </button>
            {items.length > 0 && monthEventCount === 0 && (
              <button type="button" onClick={onJumpNearestEvent} className="rounded-lg border border-cyan-500/60 bg-cyan-950/50 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-900/60">
                ⏭️ Skocz do najbliższego terminu
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {POLISH_WEEKDAYS_SHORT.map(day => (
            <div key={day} className="py-1.5">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map(cell => {
            const dayItems = itemsByDate.get(cell.dateKey) || [];
            const isSelected = selectedDateKey === cell.dateKey;
            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => onSelectDateKey(cell.dateKey)}
                className={`flex min-h-24 flex-col items-stretch rounded-xl border p-1.5 text-left transition ${
                  isSelected
                    ? 'border-cyan-400 bg-cyan-950/40 ring-1 ring-cyan-400'
                    : cell.isToday
                      ? 'border-blue-500/70 bg-blue-950/30 hover:border-blue-400'
                      : cell.inCurrentMonth
                        ? 'border-slate-700/80 bg-[#0f172a]/85 hover:border-slate-500'
                        : 'border-slate-800/60 bg-[#0b1220]/50 opacity-50 hover:opacity-80'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${cell.isToday ? 'bg-blue-600 text-white' : cell.inCurrentMonth ? 'text-slate-200' : 'text-slate-500'}`}>
                    {cell.dayNumber}
                  </span>
                  {dayItems.length > 0 && (
                    <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-200">
                      {dayItems.length}
                    </span>
                  )}
                </div>
                <div className="space-y-1 overflow-hidden">
                  {dayItems.slice(0, 2).map(item => (
                    <div
                      key={item.doc.id}
                      title={`${item.doc.title} (${item.categoryLabel})`}
                      className={`truncate rounded border px-1.5 py-0.5 text-[10px] font-semibold ${urgencyBadgeTone(item.daysLeft)}`}
                    >
                      {item.doc.title}
                    </div>
                  ))}
                  {dayItems.length > 2 && (
                    <div className="px-1 text-[10px] font-bold text-cyan-300">
                      +{dayItems.length - 2} więcej
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDateKey && (
        <div className="rounded-2xl border border-slate-700 bg-[#111c33]/90 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-sm font-bold text-white">
              📌 Terminy na dzień: <span className="text-cyan-300">{selectedDateKey.split('-').reverse().join('.')}</span> ({selectedItems.length})
            </h5>
            {onAssignDate && assignableDocs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Wybierz dokument do przypisania"
                  value={assignDocId}
                  onChange={e => setAssignDocId(e.target.value)}
                  className="max-w-60 rounded-lg border border-slate-600 bg-[#0f172a] px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">＋ Przypisz dokument do tego dnia…</option>
                  {assignableDocs.map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!assignDocId || assignBusy}
                  onClick={async () => {
                    if (!assignDocId) return;
                    setAssignBusy(true);
                    try {
                      await onAssignDate(Number(assignDocId), selectedDateKey);
                      setAssignDocId('');
                    } finally {
                      setAssignBusy(false);
                    }
                  }}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {assignBusy ? 'Zapisywanie…' : 'Ustaw termin'}
                </button>
              </div>
            )}
          </div>
          {selectedItems.length === 0 ? (
            <p className="text-xs text-slate-400">Brak wygasających dokumentów w tym dniu. Możesz przypisać dowolny dokument z listy powyżej.</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {selectedItems.map(item => (
                <div
                  key={item.doc.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-[#0f172a]/90 p-3 transition hover:border-blue-400/60"
                >
                  <button
                    type="button"
                    onClick={() => onOpenDocument(item.doc)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-400">
                      <span>{item.categoryLabel}</span>
                      {item.source === 'retention' && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">Retencja archiwum</span>
                      )}
                      {item.doc.paymentStatus === 'paid' && (
                        <span className="rounded bg-emerald-950/70 px-1.5 py-0.5 text-[10px] text-emerald-300">✓ Opłacone</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm font-bold text-white">{item.doc.title}</p>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {onMarkPaid && item.doc.paymentStatus === 'unpaid' && (
                      <button
                        type="button"
                        disabled={payingDocId === item.doc.id}
                        onClick={async () => {
                          setPayingDocId(item.doc.id);
                          try { await onMarkPaid(item.doc.id); } finally { setPayingDocId(null); }
                        }}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {payingDocId === item.doc.id ? '…' : '✓ Opłacone'}
                      </button>
                    )}
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${urgencyBadgeTone(item.daysLeft)}`}>
                      {formatDaysLeftLabel(item.daysLeft)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
