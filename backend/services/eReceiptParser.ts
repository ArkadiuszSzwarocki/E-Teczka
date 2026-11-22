export type ParsedEReceiptItem = {
  name: string;
  quantity: number;
  totalCents: number;
  category: string;
};

export type ParsedEReceipt = {
  isEReceipt: true;
  source: 'json' | 'qr';
  merchantName: string;
  amountCents: number;
  currency: string;
  issuedAt: Date | null;
  items: ParsedEReceiptItem[];
  suggestWarrantyYears: number | null;
  summaryText: string;
};

const WARRANTY_ITEM_RE =
  /\b(telewizor|laptop|smartfon|telefon|tablet|pralka|lod[óo]wka|zmywarka|odkurzacz|ekspres|monitor|drukarka|s[łl]uchawki|zegarek|smartwatch|wiertarka|szlifierka|buty|obuwie|kurtka|rower|hulajnoga|konsola|aparat|g[łl]o[śs]nik|router|dysk\s+ssd)\b/i;

function classifyEReceiptItem(name: string): string {
  const lower = name.toLowerCase();
  if (WARRANTY_ITEM_RE.test(lower)) return 'Elektronika / AGD / Gwarancja';
  if (/\b(lek|aptek|witamin|ibuprom|paracetamol|syrop|ma[śs][ćc])\b/i.test(lower)) return 'Zdrowie i apteka';
  if (/\b(paliwo|benzyna|diesel|on\b|pb95|pb98|lpg|myjnia)\b/i.test(lower)) return 'Paliwo i auto';
  if (/\b(chleb|mleko|mas[łl]o|ser|szynka|woda|kawa|herbata|jab[łl]k|banan|jogurt|jaj|mi[ęe]so)\b/i.test(lower)) return 'Spożywcze';
  return 'Zakupy (e-Paragon)';
}

function parseMoneyToCents(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 10_000_000) {
    return Number.isInteger(raw) && raw >= 100 && raw > 50_000 ? raw : Math.round(raw * 100);
  }
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num) || num <= 0 || num > 10_000_000) return null;
  return Math.round(num * 100);
}

function parseDateSafe(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseJsonEReceipt(raw: string): ParsedEReceipt | null {
  let obj: Record<string, any>;
  try {
    obj = JSON.parse(raw) as Record<string, any>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const merchantRaw =
    obj.merchantName ?? obj.merchant?.name ?? obj.seller?.name ?? obj.storeName ?? obj.sklep ?? obj.sprzedawca ?? '';
  const merchantName = String(merchantRaw || '').trim().slice(0, 120);

  const rawItems = Array.isArray(obj.items)
    ? obj.items
    : Array.isArray(obj.positions)
      ? obj.positions
      : Array.isArray(obj.produkty)
        ? obj.produkty
        : Array.isArray(obj.lineItems)
          ? obj.lineItems
          : [];

  const items: ParsedEReceiptItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.name ?? entry.title ?? entry.nazwa ?? '').trim().slice(0, 100);
    if (!name) continue;
    const qtyRaw = Number.parseFloat(String(entry.quantity ?? entry.qty ?? entry.ilosc ?? 1).replace(',', '.'));
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 && qtyRaw <= 1000 ? qtyRaw : 1;
    const totalCents =
      typeof entry.totalCents === 'number' && entry.totalCents > 0
        ? Math.round(entry.totalCents)
        : parseMoneyToCents(entry.total ?? entry.totalPrice ?? entry.price ?? entry.kwota ?? entry.wartosc);
    if (!totalCents || totalCents <= 0) continue;
    items.push({
      name,
      quantity,
      totalCents,
      category: String(entry.category || classifyEReceiptItem(name)),
    });
  }

  let amountCents =
    typeof obj.amountCents === 'number' && obj.amountCents > 0
      ? Math.round(obj.amountCents)
      : parseMoneyToCents(obj.total ?? obj.totalAmount ?? obj.suma ?? obj.amount ?? obj.kwota);
  if (amountCents === null && items.length > 0) {
    amountCents = items.reduce((sum, i) => sum + i.totalCents, 0);
  }
  if (!merchantName && items.length === 0) return null;
  if (!amountCents || amountCents <= 0) return null;

  const currency = String(obj.currency ?? obj.waluta ?? 'PLN').trim().toUpperCase().slice(0, 3) || 'PLN';
  const issuedAt = parseDateSafe(obj.issuedAt ?? obj.date ?? obj.data ?? obj.createdAt);
  const hasWarrantyItem = items.some(i => WARRANTY_ITEM_RE.test(i.name));
  const resolvedMerchant = merchantName || 'e-Paragon';

  const summaryText = [
    `e-PARAGON · ${resolvedMerchant}`,
    issuedAt ? `Data zakupu: ${issuedAt.toISOString().slice(0, 10)}` : '',
    `Suma: ${(amountCents / 100).toFixed(2)} ${currency}`,
    ...items.map(i => `- ${i.name} x${i.quantity}: ${(i.totalCents / 100).toFixed(2)} ${currency}`),
  ].filter(Boolean).join('\n');

  return {
    isEReceipt: true,
    source: 'json',
    merchantName: resolvedMerchant,
    amountCents,
    currency,
    issuedAt,
    items: items.slice(0, 150),
    suggestWarrantyYears: hasWarrantyItem ? 2 : null,
    summaryText,
  };
}

function parseQrEReceipt(raw: string): ParsedEReceipt | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Support QR URLs with query parameters (e.g. e-paragon hub / store receipt links)
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const merchant = (url.searchParams.get('merchant') || url.searchParams.get('store') || url.searchParams.get('sklep') || url.hostname.replace(/^www\./i, '')).trim();
      const amountCents = parseMoneyToCents(url.searchParams.get('total') || url.searchParams.get('amount') || url.searchParams.get('suma') || url.searchParams.get('kwota'));
      if (!amountCents) return null;
      const currency = (url.searchParams.get('currency') || 'PLN').toUpperCase().slice(0, 3);
      const issuedAt = parseDateSafe(url.searchParams.get('date') || url.searchParams.get('data'));
      return {
        isEReceipt: true,
        source: 'qr',
        merchantName: merchant.slice(0, 120) || 'e-Paragon QR',
        amountCents,
        currency,
        issuedAt,
        items: [],
        suggestWarrantyYears: null,
        summaryText: `e-PARAGON QR · ${merchant}\nSuma: ${(amountCents / 100).toFixed(2)} ${currency}\nŹródło: ${trimmed}`,
      };
    } catch {
      return null;
    }
  }

  // Support key=value or key:value QR payloads (e.g. "SKLEP:Biedronka;SUMA:48.90;DATA:2026-11-22")
  const merchantMatch = trimmed.match(/(?:sklep|merchant|store|sprzedawca)\s*[:=]\s*([^;\r\n|]+)/i);
  const amountMatch = trimmed.match(/(?:suma|total|amount|kwota)\s*[:=]\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (!amountMatch?.[1]) return null;
  const amountCents = parseMoneyToCents(amountMatch[1]);
  if (!amountCents) return null;
  const merchantName = (merchantMatch?.[1] || 'e-Paragon QR').trim().slice(0, 120);
  const dateMatch = trimmed.match(/(?:data|date)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i);
  const issuedAt = parseDateSafe(dateMatch?.[1]);

  return {
    isEReceipt: true,
    source: 'qr',
    merchantName,
    amountCents,
    currency: 'PLN',
    issuedAt,
    items: [],
    suggestWarrantyYears: null,
    summaryText: `e-PARAGON QR · ${merchantName}\nSuma: ${(amountCents / 100).toFixed(2)} PLN`,
  };
}

/** Parses e-Receipt JSON files or QR payloads into normalized receipt metadata and items. */
export function parseEReceiptPayload(raw: string): ParsedEReceipt | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    return parseJsonEReceipt(trimmed);
  }
  return parseQrEReceipt(trimmed);
}
