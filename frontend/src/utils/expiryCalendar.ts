import type { DocumentRecord } from '../types/domain';

export type ExpiryCategory = 'all' | 'auto' | 'identity' | 'warranty' | 'payment' | 'other';
export type ExpiryUrgency = 'all' | 'overdue' | 'urgent' | 'upcoming' | 'later';
export type ExpirySource = 'dueDate' | 'retention';

export type ExpiryItem = {
  doc: DocumentRecord;
  date: Date;
  dateKey: string;
  daysLeft: number;
  source: ExpirySource;
  category: Exclude<ExpiryCategory, 'all'>;
  categoryLabel: string;
};

export type CalendarCell = {
  date: Date;
  dateKey: string;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
};

export const POLISH_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
] as const;

export const POLISH_WEEKDAYS_SHORT = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'] as const;

export const CATEGORY_TABS: Array<{ id: ExpiryCategory; label: string }> = [
  { id: 'all', label: 'Wszystkie' },
  { id: 'auto', label: '🚗 Auto i polisy' },
  { id: 'identity', label: '🪪 Dokumenty' },
  { id: 'warranty', label: '🛡️ Gwarancje' },
  { id: 'payment', label: '💳 Płatności' },
  { id: 'other', label: '📅 Pozostałe' },
];

export const URGENCY_OPTIONS: Array<{ id: ExpiryUrgency; label: string }> = [
  { id: 'all', label: 'Wszystkie terminy' },
  { id: 'overdue', label: 'Po terminie' },
  { id: 'urgent', label: 'Pilne (≤ 7 dni)' },
  { id: 'upcoming', label: 'Wkrótce (≤ 30 dni)' },
  { id: 'later', label: 'Dalsze (> 30 dni)' },
];

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function classifyExpiryCategory(doc: DocumentRecord): { category: Exclude<ExpiryCategory, 'all'>; label: string } {
  const text = `${doc.title} ${doc.merchantName || ''}`.toLowerCase();
  if (/polisa|oc|ac|auto|przegl[ąa]d|badani|samoch[óo]d|ubezpiecz|pzu|warta|link4|ergo/.test(text)) {
    return { category: 'auto', label: '🚗 Auto i polisy' };
  }
  if (/dow[óo]d|paszport|prawo jazdy|legitymacj|karta pobytu/.test(text)) {
    return { category: 'identity', label: '🪪 Dokumenty' };
  }
  if (/gwarancj|r[ęe]kojmi|paragon|media|rtv|x-kom|agd|euro|komputronik/.test(text)) {
    return { category: 'warranty', label: '🛡️ Gwarancje' };
  }
  if (doc.paymentStatus === 'unpaid' || doc.amountCents !== null && doc.amountCents !== undefined || /faktur|rachun|pr[ąa]d|gaz|czynsz|internet|orange|pge|tauron|enea|play|plus/.test(text)) {
    return { category: 'payment', label: '💳 Płatności' };
  }
  return { category: 'other', label: '📅 Pozostałe' };
}

/** Resolves a document's explicit deadline (dueDate) separately from default archive retention. */
export function resolveDocExpiry(doc: DocumentRecord, includeRetention: boolean): { date: Date; source: ExpirySource } | null {
  if (doc.dueDate) {
    const parsed = new Date(doc.dueDate);
    if (!Number.isNaN(parsed.getTime())) return { date: parsed, source: 'dueDate' };
  }
  if (includeRetention && doc.retentionEnabled !== false && doc.retentionValue && doc.createdAt) {
    const base = new Date(doc.createdAt);
    if (Number.isNaN(base.getTime())) return null;
    if (doc.retentionUnit === 'years') base.setFullYear(base.getFullYear() + doc.retentionValue);
    else if (doc.retentionUnit === 'months') base.setMonth(base.getMonth() + doc.retentionValue);
    else if (doc.retentionUnit === 'days') base.setDate(base.getDate() + doc.retentionValue);
    else return null;
    return { date: base, source: 'retention' };
  }
  return null;
}

export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function buildExpiryItems(documents: DocumentRecord[], includeRetention: boolean): ExpiryItem[] {
  const todayMs = startOfLocalDay(new Date());
  const items: ExpiryItem[] = [];
  for (const doc of documents) {
    if (doc.isDeleted || doc.isArchived) continue;
    const resolved = resolveDocExpiry(doc, includeRetention);
    if (!resolved) continue;
    const daysLeft = Math.round((startOfLocalDay(resolved.date) - todayMs) / 86_400_000);
    const { category, label } = classifyExpiryCategory(doc);
    items.push({
      doc,
      date: resolved.date,
      dateKey: formatDateKey(resolved.date),
      daysLeft,
      source: resolved.source,
      category,
      categoryLabel: label,
    });
  }
  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function filterExpiryItems(
  items: ExpiryItem[],
  opts: { category: ExpiryCategory; urgency: ExpiryUrgency; query: string },
): ExpiryItem[] {
  const q = opts.query.trim().toLowerCase();
  return items.filter(item => {
    if (opts.category !== 'all' && item.category !== opts.category) return false;
    if (opts.urgency === 'overdue' && item.daysLeft >= 0) return false;
    if (opts.urgency === 'urgent' && (item.daysLeft < 0 || item.daysLeft > 7)) return false;
    if (opts.urgency === 'upcoming' && (item.daysLeft <= 7 || item.daysLeft > 30)) return false;
    if (opts.urgency === 'later' && item.daysLeft <= 30) return false;
    if (q) {
      const hay = `${item.doc.title} ${item.doc.merchantName || ''} ${item.categoryLabel}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Builds a 6-week (42-day) Monday-first calendar grid for a given year and 0-based month. */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const todayKey = formatDateKey(new Date());
  const firstOfMonth = new Date(year, month, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7; // Mon=0 .. Sun=6
  const gridStart = new Date(year, month, 1 - mondayOffset);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateKey = formatDateKey(date);
    cells.push({
      date,
      dateKey,
      dayNumber: date.getDate(),
      inCurrentMonth: date.getMonth() === month,
      isToday: dateKey === todayKey,
    });
  }
  return cells;
}

export function urgencyBadgeTone(daysLeft: number): string {
  if (daysLeft < 0) return 'border-red-500/50 bg-red-500/20 text-red-200';
  if (daysLeft <= 7) return 'border-amber-500/50 bg-amber-500/20 text-amber-200';
  if (daysLeft <= 30) return 'border-blue-500/50 bg-blue-500/20 text-blue-200';
  return 'border-slate-600 bg-slate-800/90 text-slate-300';
}

export function formatDaysLeftLabel(daysLeft: number): string {
  if (daysLeft < 0) return `${Math.abs(daysLeft)} dni po`;
  if (daysLeft === 0) return 'Dziś!';
  if (daysLeft === 1) return 'Jutro';
  return `za ${daysLeft} dni`;
}
