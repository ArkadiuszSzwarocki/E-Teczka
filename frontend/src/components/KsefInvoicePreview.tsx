import { useMemo, useState } from 'react';
import { buildPrintableKsefHtml, formatKsefVatRate, parseKsefPreviewXml } from '../services/ksefPreviewParser';

type Props = {
  xmlText: string;
  title: string;
};

/** Renders Polish KSeF XML invoices (FA(2)/FA(3)) as a readable invoice sheet with print/PDF export and raw XML toggle. */
export default function KsefInvoicePreview({ xmlText, title }: Props) {
  const [showRawXml, setShowRawXml] = useState(false);
  const invoice = useMemo(() => parseKsefPreviewXml(xmlText), [xmlText]);

  const handlePrintPdf = () => {
    if (!invoice) return;
    const html = buildPrintableKsefHtml(invoice);
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const frameDoc = frame.contentDocument || frame.contentWindow?.document;
    if (!frameDoc || !frame.contentWindow) {
      document.body.removeChild(frame);
      return;
    }
    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();
    const cleanup = () => {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    };
    frame.contentWindow.onafterprint = cleanup;
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(cleanup, 60_000);
    }, 200);
  };

  if (!invoice) {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-5">
        <div className="mx-auto max-w-4xl rounded-xl border border-slate-700 bg-slate-900 p-4">
          <p className="mb-2 text-xs font-semibold text-amber-300">Dokument XML ({title}) — podgląd źródłowy</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-200">{xmlText}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300">KSeF {invoice.schemaVersion}</span>
            <span>Wizualizacja faktury ustrukturyzowanej XML</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRawXml(v => !v)}
              className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              {showRawXml ? '📄 Podgląd faktury' : '</> Źródło XML'}
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500"
            >
              🖨️ Drukuj / Zapisz PDF
            </button>
          </div>
        </div>

        {showRawXml ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-700 bg-slate-950 p-4 font-mono text-xs text-slate-200">
            {xmlText}
          </pre>
        ) : (
          <article className="rounded-xl bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Faktura ustrukturyzowana KSeF ({invoice.schemaVersion})</p>
                <h2 className="mt-1 text-2xl font-extrabold text-slate-900">{invoice.invoiceNumber}</h2>
              </div>
              <div className="space-y-1 text-right text-xs text-slate-700">
                {invoice.issueDate && <p>Data wystawienia: <strong className="text-slate-900">{invoice.issueDate}</strong></p>}
                {invoice.saleDate && <p>Data sprzedaży: <strong className="text-slate-900">{invoice.saleDate}</strong></p>}
                {invoice.dueDate && <p>Termin płatności: <strong className="text-slate-900">{invoice.dueDate}</strong></p>}
              </div>
            </header>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <p className="font-bold uppercase tracking-wider text-slate-500">Sprzedawca</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{invoice.seller.name}</p>
                {invoice.seller.nip && <p className="mt-0.5 text-slate-700">NIP: {invoice.seller.nip}</p>}
                {invoice.seller.address && <p className="mt-0.5 text-slate-600">{invoice.seller.address}</p>}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <p className="font-bold uppercase tracking-wider text-slate-500">Nabywca</p>
                <p className="mt-1 text-sm font-bold text-slate-900">{invoice.buyer.name}</p>
                {invoice.buyer.nip && <p className="mt-0.5 text-slate-700">NIP: {invoice.buyer.nip}</p>}
                {invoice.buyer.address && <p className="mt-0.5 text-slate-600">{invoice.buyer.address}</p>}
              </div>
            </div>

            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-100 uppercase text-slate-600">
                    <th className="px-3 py-2">Lp.</th>
                    <th className="px-3 py-2">Nazwa towaru / usługi</th>
                    <th className="px-3 py-2 text-right">Ilość</th>
                    <th className="px-3 py-2 text-right">Cena jedn.</th>
                    <th className="px-3 py-2 text-right">VAT</th>
                    <th className="px-3 py-2 text-right">Wartość {invoice.valueColumnKind === 'gross' ? 'brutto' : 'netto'} ({invoice.currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.length > 0 ? invoice.items.map(item => (
                    <tr key={`${item.index}-${item.name}`} className="border-t border-slate-200">
                      <td className="px-3 py-2 text-slate-500">{item.index}</td>
                      <td className="px-3 py-2 font-medium text-slate-900">{item.name}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{item.quantity} {item.unit}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{item.unitPrice}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{formatKsefVatRate(item.vatRate)}</td>
                      <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{item.value}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-slate-500">Brak pozycji szczegółowych w pliku XML.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-4">
              <div className="space-y-1 text-xs text-slate-700">
                <p>
                  Status płatności:{' '}
                  <span className={`font-bold ${invoice.paid ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {invoice.paid ? 'Opłacona' : 'Do zapłaty'}
                  </span>
                  {invoice.paymentDate ? ` (${invoice.paymentDate})` : ''}
                </p>
                {invoice.bankAccount && <p>Rachunek bankowy: <strong className="font-mono text-slate-900">{invoice.bankAccount}</strong></p>}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-slate-500">Razem brutto</p>
                <p className="text-2xl font-extrabold text-slate-900">{invoice.totalGross} {invoice.currency}</p>
              </div>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
