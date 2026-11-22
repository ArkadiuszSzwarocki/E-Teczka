import { XMLParser } from 'fast-xml-parser';

export type ParsedKsefLineItem = {
  name: string;
  quantity: number;
  totalCents: number;
  category: string;
};

export type ParsedKsefInvoice = {
  isKsef: true;
  schemaVersion: string;
  invoiceNumber: string;
  merchantName: string;
  sellerNip: string | null;
  amountCents: number | null;
  currency: string;
  issueDate: Date | null;
  dueDate: Date | null;
  paymentStatus: 'paid' | 'unpaid';
  items: ParsedKsefLineItem[];
  summaryText: string;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
});

function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function parseMoneyToCents(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const normalized = String(raw).replace(/[\s\u00A0]/g, '').replace(',', '.');
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num <= 0 || num > 100_000_000) return null;
  return Math.round(num * 100);
}

function parseIsoDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed.slice(0, 10)}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Parses Polish KSeF structured invoice XML (FA(2) / FA(3)) into normalized financial metadata and line items. */
export function parseKsefXml(xmlText: string): ParsedKsefInvoice | null {
  if (!xmlText || typeof xmlText !== 'string' || !xmlText.includes('<')) return null;
  let parsed: Record<string, any>;
  try {
    parsed = xmlParser.parse(xmlText) as Record<string, any>;
  } catch {
    return null;
  }

  const root = parsed?.Faktura;
  if (!root || typeof root !== 'object' || !root.Fa || !root.Podmiot1) return null;

  const naglowek = root.Naglowek || {};
  const kodFormularza = naglowek.KodFormularza;
  const schemaVersion = typeof kodFormularza === 'object'
    ? String(kodFormularza['@_kodSystemowy'] || kodFormularza['#text'] || 'FA')
    : String(kodFormularza || 'FA');

  const sellerData = root.Podmiot1?.DaneIdentyfikacyjne || {};
  const sellerName = String(sellerData.Nazwa || '').trim();
  const sellerNip = sellerData.NIP ? String(sellerData.NIP).replace(/\D/g, '') : null;
  const merchantName = sellerName || (sellerNip ? `NIP ${sellerNip}` : 'Sprzedawca KSeF');

  const fa = root.Fa || {};
  const invoiceNumber = String(fa.P_2 || '').trim() || 'Faktura KSeF';
  const currency = String(fa.KodWaluty || 'PLN').trim().toUpperCase().slice(0, 3) || 'PLN';
  const amountCents = parseMoneyToCents(fa.P_15);
  const issueDate = parseIsoDate(fa.P_1);

  const platnosc = fa.Platnosc || {};
  const terminy = toArray(platnosc.TerminPlatnosci);
  let dueDate: Date | null = null;
  for (const t of terminy) {
    dueDate = parseIsoDate(typeof t === 'object' ? t?.Termin : t);
    if (dueDate) break;
  }
  const paymentStatus: 'paid' | 'unpaid' = String(platnosc.Zaplacono || '').trim() === '1' ? 'paid' : 'unpaid';

  const rawRows = toArray(fa.FaWiersz);
  const items: ParsedKsefLineItem[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.P_7 || '').trim().slice(0, 120);
    if (!name) continue;
    const qtyNum = Number.parseFloat(String(row.P_8B || '1').replace(',', '.'));
    const quantity = Number.isFinite(qtyNum) && qtyNum > 0 && qtyNum <= 10000 ? qtyNum : 1;
    const totalCents = parseMoneyToCents(row.P_11A ?? row.P_11) ?? 0;
    if (totalCents <= 0) continue;
    items.push({
      name,
      quantity,
      totalCents,
      category: 'Faktura KSeF',
    });
  }

  const totalFormatted = amountCents !== null ? `${(amountCents / 100).toFixed(2)} ${currency}` : 'brak kwoty';
  const summaryLines = [
    `FAKTURA KSeF (${schemaVersion}) nr ${invoiceNumber}`,
    `Sprzedawca: ${merchantName}${sellerNip ? ` (NIP: ${sellerNip})` : ''}`,
    issueDate ? `Data wystawienia: ${issueDate.toISOString().slice(0, 10)}` : '',
    dueDate ? `Termin płatności: ${dueDate.toISOString().slice(0, 10)}` : '',
    `Kwota brutto: ${totalFormatted}`,
    ...items.map(i => `- ${i.name} (${i.quantity} szt.) ${(i.totalCents / 100).toFixed(2)} ${currency}`),
  ].filter(Boolean);

  return {
    isKsef: true,
    schemaVersion,
    invoiceNumber,
    merchantName: merchantName.slice(0, 120),
    sellerNip,
    amountCents,
    currency,
    issueDate,
    dueDate,
    paymentStatus,
    items: items.slice(0, 150),
    summaryText: summaryLines.join('\n'),
  };
}
