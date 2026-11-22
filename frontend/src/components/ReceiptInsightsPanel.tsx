import { useState } from 'react';
import type {
  ReceiptCategorySummary,
  ReceiptItemEntry,
  ReceiptMerchantSummary,
} from '../hooks/useAnalyticsSummary';

type Props = {
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  merchants: ReceiptMerchantSummary[];
  categories: ReceiptCategorySummary[];
  items: ReceiptItemEntry[];
  onOpenDocument: (documentId: number) => void;
};

function formatPln(cents: number): string {
  return `${(cents / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN`;
}

/** Monthly receipt analytics grouped by store, item category, and searchable purchased items. */
export default function ReceiptInsightsPanel({
  selectedMonth,
  onMonthChange,
  merchants,
  categories,
  items,
  onOpenDocument,
}: Props) {
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [itemQuery, setItemQuery] = useState<string>('');

  const filteredItems = items.filter(item => {
    if (selectedStore && item.merchantName !== selectedStore) return false;
    if (selectedCategory && item.category !== selectedCategory) return false;
    if (itemQuery.trim() && !item.name.toLowerCase().includes(itemQuery.trim().toLowerCase())) return false;
    return true;
  });

  const filteredTotal = filteredItems.reduce((sum, item) => sum + item.totalCents, 0);

  return (
    <section id="receipt-insights-panel" className="cyber-card space-y-5 rounded-xl border border-slate-700 bg-[#1e293b] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Paragony: zakupy wg sklepów i artykułów</h3>
          <p className="mt-1 text-xs text-slate-400">Automatycznie odczytane z OCR zdjęć i skanów, e-Paragonów (QR/JSON) oraz faktur KSeF (XML)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={selectedMonth}
            onChange={e => { if (e.target.value) onMonthChange(e.target.value); }}
            className="cyber-input rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-white"
            aria-label="Miesiąc podsumowania paragonów"
          />
          <input
            type="text"
            value={itemQuery}
            onChange={e => setItemQuery(e.target.value)}
            placeholder="Szukaj artykułu (np. mleko, paliwo)…"
            className="cyber-input w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-white sm:w-56"
          />
        </div>
      </div>

      {merchants.length === 0 && items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          Brak rozpoznanych paragonów w wybranym miesiącu. Dodaj zdjęcie paragonu z włączonym OCR, aby zobaczyć podsumowanie sklepów i artykułów.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sklepy w miesiącu</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedStore('')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${!selectedStore ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                >
                  Wszystkie sklepy
                </button>
                {merchants.map(m => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => setSelectedStore(prev => (prev === m.name ? '' : m.name))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${selectedStore === m.name ? 'border-cyan-400 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                  >
                    {m.name} · {formatPln(m.totalCents)} ({m.receiptCount})
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Kategorie artykułów</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('')}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${!selectedCategory ? 'border-blue-400 bg-blue-500/15 text-blue-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                >
                  Wszystkie kategorie
                </button>
                {categories.map(c => (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => setSelectedCategory(prev => (prev === c.category ? '' : c.category))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${selectedCategory === c.category ? 'border-blue-400 bg-blue-500/15 text-blue-200' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
                  >
                    {c.category} · {formatPln(c.totalCents)} ({c.itemCount})
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="max-h-72 overflow-x-auto overflow-y-auto rounded-lg border border-slate-700/80">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-3 py-2">Artykuł</th>
                  <th className="px-3 py-2">Sklep</th>
                  <th className="px-3 py-2">Kategoria</th>
                  <th className="px-3 py-2 text-right">Ilość</th>
                  <th className="px-3 py-2 text-right">Kwota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredItems.map(item => (
                  <tr key={item.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-medium text-white">
                      <button type="button" onClick={() => onOpenDocument(item.documentId)} className="text-left hover:text-cyan-300">
                        {item.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{item.merchantName}</td>
                    <td className="px-3 py-2 text-slate-400">{item.category}</td>
                    <td className="px-3 py-2 text-right text-slate-300">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-semibold text-cyan-300">{formatPln(item.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-900/70 font-bold text-white">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right text-slate-300">Suma pozycji ({filteredItems.length}):</td>
                  <td className="px-3 py-2 text-right text-cyan-300">{formatPln(filteredTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
