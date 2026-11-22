import { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import { buildPrintableKsefHtml, formatKsefVatRate, parseKsefPreviewXml } from '../services/ksefPreviewParser';
import { resolveApiBase } from '../services/apiBase';
import { buildZbpTransferQr } from '../utils/zbpQr';

type VatWhitelistStatus = {
  checked: boolean;
  statusVat: string | null;
  isActiveVat: boolean;
  ibanChecked: boolean;
  ibanMatch: boolean | null;
  requestId: string | null;
  error?: string;
};

type Props = {
  xmlText: string;
  title: string;
};

/** Renders Polish KSeF XML invoices (FA(2)/FA(3)) with ZBP transfer QR, MF VAT Whitelist check, and PDF print. */
export default function KsefInvoicePreview({ xmlText, title }: Props) {
  const [showRawXml, setShowRawXml] = useState(false);
  const [vatStatus, setVatStatus] = useState<VatWhitelistStatus | null>(null);
  const [vatLoading, setVatLoading] = useState(false);
  const invoice = useMemo(() => parseKsefPreviewXml(xmlText), [xmlText]);
  const zbpQrPayload = useMemo(
    () => (invoice ? buildZbpTransferQr({
      nip: invoice.seller.nip,
      iban: invoice.bankAccount,
      amountGross: invoice.totalGross,
      recipient: invoice.seller.name,
      title: invoice.invoiceNumber,
    }) : null),
    [invoice],
  );

  useEffect(() => {
    if (!invoice?.seller.nip) {
      setVatStatus(null);
      return;
    }
    let active = true;
    setVatLoading(true);
    const apiBase = resolveApiBase(window.location, import.meta.env.VITE_API_URL);
    const token = localStorage.getItem('mojateczka_auth_token');
    const params = new URLSearchParams({ nip: invoice.seller.nip });
    if (invoice.bankAccount) params.set('iban', invoice.bankAccount);
    if (invoice.issueDate) params.set('date', invoice.issueDate.slice(0, 10));
    void fetch(`${apiBase}/api/ksef/vat-whitelist?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async res => (res.ok ? (await res.json()) as VatWhitelistStatus : null))
      .then(data => { if (active && data) setVatStatus(data); })
      .catch(() => undefined)
      .finally(() => { if (active) setVatLoading(false); });
    return () => { active = false; };
  }, [invoice?.seller.nip, invoice?.bankAccount, invoice?.issueDate]);

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
                {invoice.seller.nip && (
                  <div className="mt-2">
                    {vatLoading ? (
                      <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        Sprawdzanie Białej Listy VAT (MF)…
                      </span>
                    ) : vatStatus?.checked ? (
                      vatStatus.isActiveVat && vatStatus.ibanMatch !== false ? (
                        <span className="inline-flex flex-wrap items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                          ✓ Czynny podatnik VAT{vatStatus.ibanChecked ? ' · Rachunek na Białej Liście' : ''}
                        </span>
                      ) : (
                        <span className="inline-flex flex-wrap items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-800">
                          ⚠️ {!vatStatus.isActiveVat ? `Status VAT: ${vatStatus.statusVat || 'Niezarejestrowany'}` : 'Rachunek bankowy NIE widnieje na Białej Liście VAT!'}
                        </span>
                      )
                    ) : null}
                  </div>
                )}
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

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
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
              {zbpQrPayload && !invoice.paid && (
                <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/70 p-2.5">
                  <div className="shrink-0 rounded bg-white p-1 shadow-sm">
                    <QRCode value={zbpQrPayload} size={84} />
                  </div>
                  <div className="max-w-[170px] text-[11px] leading-4 text-slate-700">
                    <p className="font-bold text-blue-900">QR przelew (ZBP)</p>
                    <p className="mt-0.5">Zeskanuj w aplikacji banku (PKO, mBank, ING, Pekao, Santander) — przelew w 3 sekundy.</p>
                  </div>
                </div>
              )}
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
