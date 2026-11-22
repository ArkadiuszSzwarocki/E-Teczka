import { useMemo, useState } from 'react';

type ReceiptItem = {
  name: string;
  quantity: number;
  totalCents: number;
  category?: string;
};

type ParsedReceiptView = {
  merchantName: string;
  amountCents: number | null;
  currency: string;
  issuedAt: string;
  warrantyYears: number | null;
  items: ReceiptItem[];
};

function extractReceiptView(jsonText: string): ParsedReceiptView | null {
  try {
    const raw = JSON.parse(jsonText) as Record<string, any>;
    if (!raw || typeof raw !== 'object') return null;
    const src = raw.parsed && typeof raw.parsed === 'object' ? (raw.parsed as Record<string, any>) : raw;
    const merchantName = String(src.merchantName ?? src.merchant?.name ?? src.storeName ?? src.sklep ?? '').trim();
    const rawItems = Array.isArray(src.items) ? src.items : Array.isArray(src.positions) ? src.positions : Array.isArray(src.produkty) ? src.produkty : [];
    const items: ReceiptItem[] = rawItems
      .filter((entry): entry is Record<string, any> => Boolean(entry && typeof entry === 'object'))
      .map(entry => {
        const cents = typeof entry.totalCents === 'number'
          ? Math.round(entry.totalCents)
          : Math.round(Number.parseFloat(String(entry.total ?? entry.price ?? entry.kwota ?? 0).replace(',', '.')) * 100);
        return {
          name: String(entry.name ?? entry.title ?? entry.nazwa ?? 'Pozycja').trim(),
          quantity: Number(entry.quantity ?? entry.qty ?? entry.ilosc ?? 1) || 1,
          totalCents: Number.isFinite(cents) ? cents : 0,
          category: typeof entry.category === 'string' ? entry.category : undefined,
        };
      });
    const amountCents = typeof src.amountCents === 'number'
      ? Math.round(src.amountCents)
      : Number.isFinite(Number.parseFloat(String(src.total ?? src.suma ?? src.amount ?? '')))
        ? Math.round(Number.parseFloat(String(src.total ?? src.suma ?? src.amount).replace(',', '.')) * 100)
        : items.length > 0 ? items.reduce((sum, i) => sum + i.totalCents, 0) : null;
    if (!merchantName && items.length === 0 && amountCents === null) return null;
    const issuedRaw = src.issuedAt ?? src.date ?? src.data ?? '';
    const issuedAt = typeof issuedRaw === 'string' && issuedRaw ? issuedRaw.slice(0, 10) : '';
    return {
      merchantName: merchantName || 'e-Paragon',
      amountCents,
      currency: String(src.currency ?? src.waluta ?? 'PLN').toUpperCase().slice(0, 3) || 'PLN',
      issuedAt,
      warrantyYears: typeof src.suggestWarrantyYears === 'number' ? src.suggestWarrantyYears : null,
      items,
    };
  } catch {
    return null;
  }
}

type Props = {
  jsonText: string;
  title: string;
};

/** Renders imported JSON e-Receipts as a clean receipt card with raw JSON toggle. */
export default function EReceiptPreview({ jsonText, title }: Props) {
  const [showRawJson, setShowRawJson] = useState(false);
  const receipt = useMemo(() => extractReceiptView(jsonText), [jsonText]);

  if (!receipt) {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-5">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <p className="mb-2 text-xs font-semibold text-amber-300">Dokument JSON ({title}) — podgląd źródłowy</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-200">{jsonText}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5">
          <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-bold text-cyan-200">🧾 e-Paragon (JSON)</span>
          <button
            type="button"
            onClick={() => setShowRawJson(v => !v)}
            className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            {showRawJson ? '🧾 Widok paragonu' : '</> Źródło JSON'}
          </button>
        </div>

        {showRawJson ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-700 bg-slate-950 p-4 font-mono text-xs text-slate-200">
            {jsonText}
          </pre>
        ) : (
          <article className="rounded-xl bg-white p-6 text-slate-900 shadow-2xl">
            <header className="border-b border-dashed border-slate-300 pb-4 text-center">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">PARAGON FISKALNY · E-PARAGON</p>
              <h2 className="mt-1 text-xl font-extrabold text-slate-900">{receipt.merchantName}</h2>
              {receipt.issuedAt && <p className="mt-1 text-xs text-slate-600">Data zakupu: {receipt.issuedAt}</p>}
            </header>

            <div className="mt-4 space-y-2 border-b border-dashed border-slate-300 pb-4 text-xs">
              {receipt.items.length > 0 ? receipt.items.map((item, idx) => (
                <div key={`${idx}-${item.name}`} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {item.quantity} szt.{item.category ? ` · ${item.category}` : ''}
                    </p>
                  </div>
                  <p className="font-mono font-bold text-slate-900 whitespace-nowrap">
                    {(item.totalCents / 100).toFixed(2)} {receipt.currency}
                  </p>
                </div>
              )) : (
                <p className="text-center text-slate-500">Brak szczegółowych pozycji na e-Paragonie.</p>
              )}
            </div>

            <footer className="mt-4 flex items-center justify-between">
              <span className="text-sm font-bold uppercase text-slate-600">Suma PLN</span>
              <span className="font-mono text-2xl font-extrabold text-slate-900">
                {receipt.amountCents !== null ? `${(receipt.amountCents / 100).toFixed(2)} ${receipt.currency}` : '—'}
              </span>
            </footer>

            {receipt.warrantyYears && (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-800">
                🛡️ Wykryto produkt z gwarancją — sugerowany okres przechowywania: {receipt.warrantyYears} lata
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
