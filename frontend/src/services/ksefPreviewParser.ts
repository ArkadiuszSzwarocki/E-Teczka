export type KsefParty = {
  name: string;
  nip: string;
  address: string;
};

export type KsefLineItem = {
  index: string;
  name: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  value: string;
  vatRate: string;
};

export type KsefPreviewInvoice = {
  schemaVersion: string;
  invoiceNumber: string;
  issueDate: string;
  saleDate: string;
  currency: string;
  totalGross: string;
  seller: KsefParty;
  buyer: KsefParty;
  paid: boolean;
  paymentDate: string;
  dueDate: string;
  bankAccount: string;
  items: KsefLineItem[];
};

function directChildren(parent: Element | null, localName: string): Element[] {
  if (!parent) return [];
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i += 1) {
    const el = parent.children[i];
    if (el.localName === localName) out.push(el);
  }
  return out;
}

function firstChild(parent: Element | null, localName: string): Element | null {
  return directChildren(parent, localName)[0] ?? null;
}

function childText(parent: Element | null, localName: string): string {
  return firstChild(parent, localName)?.textContent?.trim() ?? '';
}

function parseParty(partyEl: Element | null): KsefParty {
  const idEl = firstChild(partyEl, 'DaneIdentyfikacyjne');
  const addrEl = firstChild(partyEl, 'Adres');
  const addressParts = [
    childText(addrEl, 'AdresL1'),
    childText(addrEl, 'AdresL2'),
    childText(addrEl, 'KodKraju'),
  ].filter(Boolean);
  return {
    name: childText(idEl, 'Nazwa') || 'Brak nazwy',
    nip: childText(idEl, 'NIP'),
    address: addressParts.join(', '),
  };
}

/** Parses Polish KSeF FA(2)/FA(3) XML using native browser DOMParser for visual invoice rendering. */
export function parseKsefPreviewXml(xmlText: string): KsefPreviewInvoice | null {
  if (!xmlText || !xmlText.includes('<')) return null;
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const root = doc.documentElement;
  if (!root || root.localName !== 'Faktura') return null;

  const fa = firstChild(root, 'Fa');
  if (!fa) return null;

  const header = firstChild(root, 'Naglowek');
  const formCodeEl = firstChild(header, 'KodFormularza');
  const schemaVersion = formCodeEl?.getAttribute('kodSystemowy') || formCodeEl?.textContent?.trim() || 'FA';

  const payment = firstChild(fa, 'Platnosc');
  const dueEl = firstChild(payment, 'TerminPlatnosci');
  const dueDate = childText(dueEl, 'Termin') || dueEl?.textContent?.trim() || '';
  const bankEl = firstChild(payment, 'RachunekBankowy');

  const items: KsefLineItem[] = directChildren(fa, 'FaWiersz').map((row, idx) => ({
    index: childText(row, 'NrWierszaFa') || String(idx + 1),
    name: childText(row, 'P_7') || 'Pozycja bez nazwy',
    unit: childText(row, 'P_8A') || 'szt.',
    quantity: childText(row, 'P_8B') || '1',
    unitPrice: childText(row, 'P_9A') || childText(row, 'P_9B') || '—',
    value: childText(row, 'P_11A') || childText(row, 'P_11') || '—',
    vatRate: childText(row, 'P_12') || '—',
  }));

  return {
    schemaVersion,
    invoiceNumber: childText(fa, 'P_2') || 'Faktura KSeF',
    issueDate: childText(fa, 'P_1'),
    saleDate: childText(fa, 'P_6'),
    currency: childText(fa, 'KodWaluty') || 'PLN',
    totalGross: childText(fa, 'P_15') || '0.00',
    seller: parseParty(firstChild(root, 'Podmiot1')),
    buyer: parseParty(firstChild(root, 'Podmiot2')),
    paid: childText(payment, 'Zaplacono') === '1',
    paymentDate: childText(payment, 'DataZaplaty'),
    dueDate,
    bankAccount: childText(bankEl, 'NrRB'),
    items,
  };
}

export function formatKsefVatRate(rate: string): string {
  const trimmed = rate.trim();
  if (!trimmed || trimmed === '—') return '—';
  return /^\d+([.,]\d+)?$/.test(trimmed) ? `${trimmed}%` : trimmed;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Builds a clean standalone printable HTML invoice sheet for printing or saving as PDF. */
export function buildPrintableKsefHtml(inv: KsefPreviewInvoice): string {
  const rowsHtml = inv.items.map(item => `
    <tr>
      <td>${escapeHtml(item.index)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="num">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td>
      <td class="num">${escapeHtml(item.unitPrice)}</td>
      <td class="num">${escapeHtml(formatKsefVatRate(item.vatRate))}</td>
      <td class="num"><strong>${escapeHtml(item.value)}</strong></td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <title>Faktura KSeF ${escapeHtml(inv.invoiceNumber)}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 24px; font-size: 13px; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
    .badge { display: inline-block; background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 18px; }
    .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; }
    .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #cbd5e1; padding: 8px 6px; text-align: left; }
    th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; }
    .num { text-align: right; white-space: nowrap; }
    .total { margin-top: 16px; text-align: right; font-size: 18px; font-weight: 800; }
    .meta { margin-top: 14px; font-size: 12px; color: #334155; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <span class="badge">KSeF · ${escapeHtml(inv.schemaVersion)}</span>
      <h1 style="margin:6px 0 0;font-size:20px;">Faktura ${escapeHtml(inv.invoiceNumber)}</h1>
    </div>
    <div style="text-align:right;">
      ${inv.issueDate ? `<div>Data wystawienia: <strong>${escapeHtml(inv.issueDate)}</strong></div>` : ''}
      ${inv.saleDate ? `<div>Data sprzedaży: <strong>${escapeHtml(inv.saleDate)}</strong></div>` : ''}
      ${inv.dueDate ? `<div>Termin płatności: <strong>${escapeHtml(inv.dueDate)}</strong></div>` : ''}
    </div>
  </div>
  <div class="grid">
    <div class="box">
      <h3>Sprzedawca</h3>
      <div><strong>${escapeHtml(inv.seller.name)}</strong></div>
      ${inv.seller.nip ? `<div>NIP: ${escapeHtml(inv.seller.nip)}</div>` : ''}
      ${inv.seller.address ? `<div>${escapeHtml(inv.seller.address)}</div>` : ''}
    </div>
    <div class="box">
      <h3>Nabywca</h3>
      <div><strong>${escapeHtml(inv.buyer.name)}</strong></div>
      ${inv.buyer.nip ? `<div>NIP: ${escapeHtml(inv.buyer.nip)}</div>` : ''}
      ${inv.buyer.address ? `<div>${escapeHtml(inv.buyer.address)}</div>` : ''}
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Lp.</th><th>Nazwa towaru / usługi</th><th class="num">Ilość</th><th class="num">Cena jedn.</th><th class="num">VAT</th><th class="num">Wartość (${escapeHtml(inv.currency)})</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="6">Brak szczegółowych pozycji w pliku XML.</td></tr>'}</tbody>
  </table>
  <div class="total">Razem brutto: ${escapeHtml(inv.totalGross)} ${escapeHtml(inv.currency)}</div>
  <div class="meta">
    <div>Status płatności: <strong>${inv.paid ? 'Opłacona' : 'Do zapłaty'}</strong>${inv.paymentDate ? ` (${escapeHtml(inv.paymentDate)})` : ''}</div>
    ${inv.bankAccount ? `<div>Rachunek bankowy: <strong>${escapeHtml(inv.bankAccount)}</strong></div>` : ''}
  </div>
</body>
</html>`;
}
