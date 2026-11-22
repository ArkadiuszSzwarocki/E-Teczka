import { useMemo, useState } from 'react';
import type { DocumentRecord } from '../types/domain';
import EmergencyKitCard from './EmergencyKitCard';

type CategoryFilter = 'all' | 'auto' | 'identity' | 'warranty' | 'other';

type ExpiryItem = {
  doc: DocumentRecord;
  date: Date;
  daysLeft: number;
  category: Exclude<CategoryFilter, 'all'>;
  categoryLabel: string;
};

function classifyCategory(title: string): { category: Exclude<CategoryFilter, 'all'>; label: string } {
  const lower = title.toLowerCase();
  if (/polisa|oc|ac|auto|przegl[ąa]d|badani|samoch[óo]d|ubezpiecz/.test(lower)) return { category: 'auto', label: '🚗 Auto i polisy' };
  if (/dow[óo]d|paszport|prawo jazdy|legitymacj/.test(lower)) return { category: 'identity', label: '🪪 Dokumenty' };
  if (/gwarancj|r[ęe]kojmi|paragon|media|rtv|x-kom|agd/.test(lower)) return { category: 'warranty', label: '🛡️ Gwarancje' };
  return { category: 'other', label: '📅 Terminy i rachunki' };
}

function resolveDocExpiry(doc: DocumentRecord): Date | null {
  if (doc.dueDate) {
    const parsed = new Date(doc.dueDate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (doc.retentionEnabled !== false && doc.retentionValue && doc.createdAt) {
    const base = new Date(doc.createdAt);
    if (Number.isNaN(base.getTime())) return null;
    if (doc.retentionUnit === 'years') base.setFullYear(base.getFullYear() + doc.retentionValue);
    else if (doc.retentionUnit === 'months') base.setMonth(base.getMonth() + doc.retentionValue);
    else if (doc.retentionUnit === 'days') base.setDate(base.getDate() + doc.retentionValue);
    else return null;
    return base;
  }
  return null;
}

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
};

/** Dedicated Guardian view ("Kalendarz ważności") grouping policies, inspections, IDs, and warranties by urgency. */
export default function ExpiryCalendarView({ apiUrl, fetcher, documents, onOpenDocument }: Props) {
  const [filter, setFilter] = useState<CategoryFilter>('all');

  const items = useMemo<ExpiryItem[]>(() => {
    const nowMs = Date.now();
    const result: ExpiryItem[] = [];
    for (const doc of documents) {
      if (doc.isDeleted || doc.isArchived) continue;
      const date = resolveDocExpiry(doc);
      if (!date) continue;
      const daysLeft = Math.ceil((date.getTime() - nowMs) / 86_400_000);
      const { category, label } = classifyCategory(doc.title);
      if (filter !== 'all' && category !== filter) continue;
      result.push({ doc, date, daysLeft, category, categoryLabel: label });
    }
    return result.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [documents, filter]);

  const overdue = items.filter(i => i.daysLeft < 0);
  const urgent = items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7);
  const upcoming = items.filter(i => i.daysLeft > 7 && i.daysLeft <= 30);
  const later = items.filter(i => i.daysLeft > 30);

  const renderGroup = (heading: string, list: ExpiryItem[], toneClass: string) => {
    if (list.length === 0) return null;
    return (
      <div className="space-y-2">
        <h4 className={`text-xs font-bold uppercase tracking-wider ${toneClass}`}>{heading} ({list.length})</h4>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {list.map(({ doc, date, daysLeft, categoryLabel }) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpenDocument(doc)}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#111c33]/90 p-3.5 text-left transition hover:border-blue-400/60"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-slate-400">{categoryLabel}</p>
                <p className="truncate text-sm font-bold text-white">{doc.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">Termin: {date.toLocaleDateString('pl-PL')}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${daysLeft < 0 ? 'bg-red-500/20 text-red-300' : daysLeft <= 7 ? 'bg-amber-500/20 text-amber-300' : daysLeft <= 30 ? 'bg-blue-500/20 text-blue-200' : 'bg-slate-800 text-slate-300'}`}>
                {daysLeft < 0 ? `${Math.abs(daysLeft)} dni po` : daysLeft === 0 ? 'Dziś!' : `za ${daysLeft} dni`}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const tabs: Array<{ id: CategoryFilter; label: string }> = [
    { id: 'all', label: 'Wszystkie' },
    { id: 'auto', label: '🚗 Auto i polisy' },
    { id: 'identity', label: '🪪 Dokumenty' },
    { id: 'warranty', label: '🛡️ Gwarancje' },
    { id: 'other', label: '📅 Pozostałe' },
  ];

  return (
    <section className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-white">🗓️ Kalendarz ważności</h3>
          <p className="mt-1 text-xs text-slate-400">Strażnik polis OC/AC, przeglądów auta, ważności dokumentów i 2-letnich gwarancji. Na telefonie dostajesz przypomnienia 30, 7 i 1 dzień przed końcem.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${filter === t.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-[#111c33]/60 p-8 text-center text-sm text-slate-400">
          Brak dokumentów z ustawionym terminem ważności w wybranej kategorii. Zeskanuj polisę, przegląd lub paragon — OCR wykryje datę automatycznie.
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
