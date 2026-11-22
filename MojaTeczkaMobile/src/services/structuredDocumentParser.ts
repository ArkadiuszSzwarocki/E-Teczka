export type StructuredLineItem = {
  name: string;
  quantity: string;
  unitPrice?: string;
  total: string;
  vatRate?: string;
};

export type StructuredDocView = {
  kind: 'ksef' | 'ereceipt';
  badge: string;
  number: string;
  sellerName: string;
  sellerNip?: string;
  buyerName?: string;
  buyerNip?: string;
  issueDate?: string;
  dueDate?: string;
  currency: string;
  netTotal?: string;
  vatTotal?: string;
  grossTotal?: string;
  items: StructuredLineItem[];
};

const xmlTag = (xml: string, tag: string): string => {
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

const xmlBlock = (xml: string, tag: string): string => {
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
};

const xmlAllBlocks = (xml: string, tag: string): string[] => {
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_]+:)?${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
};

const fmtMoney = (val: unknown): string | undefined => {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(String(val).replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : String(val);
};

/** Parses KSeF FA(2)/FA(3) XML or e-Receipt JSON into a unified mobile card model. */
export function parseStructuredDocument(raw: string, ext: string, mimeType?: string): StructuredDocView | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isXml = ext === 'xml' || Boolean(mimeType?.includes('xml')) || trimmed.startsWith('<');
  if (isXml && /<(?:[a-zA-Z0-9_]+:)?Faktura[\s>]/i.test(trimmed)) {
    const podmiot1 = xmlBlock(trimmed, 'Podmiot1');
    const podmiot2 = xmlBlock(trimmed, 'Podmiot2');
    const fa = xmlBlock(trimmed, 'Fa') || trimmed;
    const rows = xmlAllBlocks(fa, 'FaWiersz');
    const items: StructuredLineItem[] = rows.slice(0, 100).map((row, idx) => {
      const name = xmlTag(row, 'P_7') || `Pozycja ${idx + 1}`;
      const qty = xmlTag(row, 'P_8B') || '1';
      const unit = xmlTag(row, 'P_8A');
      const unitPrice = fmtMoney(xmlTag(row, 'P_9B') || xmlTag(row, 'P_9A'));
      const total = fmtMoney(xmlTag(row, 'P_11A') || xmlTag(row, 'P_11')) || '0,00';
      const vat = xmlTag(row, 'P_12');
      return {
        name,
        quantity: unit ? `${qty} ${unit}` : qty,
        unitPrice,
        total,
        vatRate: vat ? (/^\d+$/.test(vat) ? `${vat}%` : vat) : undefined,
      };
    });
    const currency = xmlTag(fa, 'KodWaluty') || 'PLN';
    const grossTotal = fmtMoney(xmlTag(fa, 'P_15'));
    const netTotal = fmtMoney(xmlTag(fa, 'P_13_1') || xmlTag(fa, 'P_13_2') || xmlTag(fa, 'P_13_3'));
    const vatTotal = fmtMoney(xmlTag(fa, 'P_14_1') || xmlTag(fa, 'P_14_2') || xmlTag(fa, 'P_14_3'));
    const dueDate = xmlTag(fa, 'Termin') || undefined;

    return {
      kind: 'ksef',
      badge: 'Faktura KSeF',
      number: xmlTag(fa, 'P_2') || 'Bez numeru',
      sellerName: xmlTag(podmiot1, 'Nazwa') || xmlTag(podmiot1, 'PelnaNazwa') || 'Sprzedawca',
      sellerNip: xmlTag(podmiot1, 'NIP') || undefined,
      buyerName: xmlTag(podmiot2, 'Nazwa') || xmlTag(podmiot2, 'PelnaNazwa') || undefined,
      buyerNip: xmlTag(podmiot2, 'NIP') || undefined,
      issueDate: xmlTag(fa, 'P_1') || undefined,
      dueDate,
      currency,
      netTotal,
      vatTotal,
      grossTotal,
      items,
    };
  }

  const isJson = ext === 'json' || Boolean(mimeType?.includes('json')) || trimmed.startsWith('{');
  if (isJson) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (!obj || typeof obj !== 'object') return null;
      const seller = (obj.seller || obj.merchant || obj.sprzedawca || {}) as Record<string, unknown>;
      const rawItems = (Array.isArray(obj.items) ? obj.items : Array.isArray(obj.pozycje) ? obj.pozycje : Array.isArray(obj.lineItems) ? obj.lineItems : []) as Array<Record<string, unknown>>;
      const items: StructuredLineItem[] = rawItems.slice(0, 100).map((it, idx) => ({
        name: String(it.name || it.nazwa || `Pozycja ${idx + 1}`),
        quantity: String(it.quantity ?? it.ilosc ?? 1),
        unitPrice: fmtMoney(it.unitPrice ?? it.cena),
        total: fmtMoney(it.total ?? it.wartosc ?? (typeof it.totalCents === 'number' ? it.totalCents / 100 : undefined)) || '0,00',
        vatRate: it.vat ? String(it.vat) : undefined,
      }));
      const grossRaw = obj.total ?? obj.grossTotal ?? obj.suma ?? (typeof obj.amountCents === 'number' ? obj.amountCents / 100 : undefined);
      return {
        kind: 'ereceipt',
        badge: 'e-Paragon',
        number: String(obj.receiptNumber || obj.numer || obj.id || 'Paragon elektroniczny'),
        sellerName: String(seller.name || seller.nazwa || obj.merchantName || obj.store || 'Sklep'),
        sellerNip: seller.nip ? String(seller.nip) : (obj.nip ? String(obj.nip) : undefined),
        issueDate: String(obj.date || obj.issueDate || obj.data || '').slice(0, 16) || undefined,
        currency: String(obj.currency || obj.waluta || 'PLN'),
        grossTotal: fmtMoney(grossRaw),
        items,
      };
    } catch {
      return null;
    }
  }

  return null;
}

const escHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Generates clean print-ready HTML for exporting a KSeF invoice or e-Receipt to PDF via expo-print. */
export function buildStructuredDocPrintHtml(doc: StructuredDocView): string {
  const rowsHtml = doc.items.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escHtml(item.name)}</td>
      <td style="text-align:right">${escHtml(item.quantity)}</td>
      <td style="text-align:right">${escHtml(item.vatRate || '—')}</td>
      <td style="text-align:right;font-weight:600">${escHtml(item.total)} ${escHtml(doc.currency)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><style>
  body{font-family:system-ui,-apple-system,sans-serif;color:#0f172a;padding:28px;font-size:13px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #2563eb;padding-bottom:14px;margin-bottom:18px}
  .badge{display:inline-block;background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase}
  h1{margin:6px 0 0;font-size:20px}
  .grid{display:flex;gap:24px;margin-bottom:18px}
  .box{flex:1;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:12px}
  .lbl{font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{border-bottom:1px solid #e2e8f0;padding:8px 6px;text-align:left}
  th{background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#475569}
  .totals{margin-top:18px;text-align:right;font-size:15px}
  .gross{font-size:20px;font-weight:800;color:#1d4ed8}
  .foot{margin-top:28px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:10px}
</style></head><body>
  <div class="top">
    <div><span class="badge">${escHtml(doc.badge)}</span><h1>${escHtml(doc.number)}</h1></div>
    <div style="text-align:right">
      ${doc.issueDate ? `<div><strong>Data wystawienia:</strong> ${escHtml(doc.issueDate)}</div>` : ''}
      ${doc.dueDate ? `<div><strong>Termin płatności:</strong> ${escHtml(doc.dueDate)}</div>` : ''}
    </div>
  </div>
  <div class="grid">
    <div class="box"><div class="lbl">Sprzedawca</div><div><strong>${escHtml(doc.sellerName)}</strong></div>${doc.sellerNip ? `<div>NIP: ${escHtml(doc.sellerNip)}</div>` : ''}</div>
    ${doc.buyerName ? `<div class="box"><div class="lbl">Nabywca</div><div><strong>${escHtml(doc.buyerName)}</strong></div>${doc.buyerNip ? `<div>NIP: ${escHtml(doc.buyerNip)}</div>` : ''}</div>` : ''}
  </div>
  ${doc.items.length ? `<table><thead><tr><th>Lp.</th><th>Nazwa</th><th style="text-align:right">Ilość</th><th style="text-align:right">VAT</th><th style="text-align:right">Wartość</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : ''}
  <div class="totals">
    ${doc.netTotal ? `<div>Netto: ${escHtml(doc.netTotal)} ${escHtml(doc.currency)}</div>` : ''}
    ${doc.vatTotal ? `<div>VAT: ${escHtml(doc.vatTotal)} ${escHtml(doc.currency)}</div>` : ''}
    ${doc.grossTotal ? `<div class="gross">Razem: ${escHtml(doc.grossTotal)} ${escHtml(doc.currency)}</div>` : ''}
  </div>
  <div class="foot">Wygenerowano w aplikacji MojaTeczka</div>
</body></html>`;
}
