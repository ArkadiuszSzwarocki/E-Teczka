export type ParsedReceiptItem = {
  name: string;
  quantity: number;
  totalCents: number;
  category: string;
};

export type ParsedReceipt = {
  isReceipt: boolean;
  merchantName: string | null;
  amountCents: number | null;
  paymentStatus: 'paid' | 'unpaid' | null;
  items: ParsedReceiptItem[];
};

const KNOWN_STORES: Array<{ pattern: RegExp; name: string; defaultCategory?: string }> = [
  { pattern: /\bbiedronk/i, name: 'Biedronka', defaultCategory: 'Spożywcze' },
  { pattern: /\blidl\b/i, name: 'Lidl', defaultCategory: 'Spożywcze' },
  { pattern: /\bdino\b/i, name: 'Dino', defaultCategory: 'Spożywcze' },
  { pattern: /\bkaufland/i, name: 'Kaufland', defaultCategory: 'Spożywcze' },
  { pattern: /\bauchan/i, name: 'Auchan', defaultCategory: 'Spożywcze' },
  { pattern: /\bcarrefour/i, name: 'Carrefour', defaultCategory: 'Spożywcze' },
  { pattern: /\b[żz]abka/i, name: 'Żabka', defaultCategory: 'Spożywcze' },
  { pattern: /\bnetto\b/i, name: 'Netto', defaultCategory: 'Spożywcze' },
  { pattern: /\baldi\b/i, name: 'Aldi', defaultCategory: 'Spożywcze' },
  { pattern: /\borlen\b|pkn\s+orlen/i, name: 'Orlen', defaultCategory: 'Paliwo i auto' },
  { pattern: /\bshell\b/i, name: 'Shell', defaultCategory: 'Paliwo i auto' },
  { pattern: /\bbp\b\s*(?:europa|polska)?/i, name: 'BP', defaultCategory: 'Paliwo i auto' },
  { pattern: /\bcircle\s*k/i, name: 'Circle K', defaultCategory: 'Paliwo i auto' },
  { pattern: /\bmoya\b/i, name: 'Moya', defaultCategory: 'Paliwo i auto' },
  { pattern: /\brossmann/i, name: 'Rossmann', defaultCategory: 'Zdrowie i higiena' },
  { pattern: /\bhebe\b/i, name: 'Hebe', defaultCategory: 'Zdrowie i higiena' },
  { pattern: /\bapteka\b/i, name: 'Apteka', defaultCategory: 'Zdrowie i higiena' },
  { pattern: /\bcastorama/i, name: 'Castorama', defaultCategory: 'Dom i remont' },
  { pattern: /\bleroy\s*merlin/i, name: 'Leroy Merlin', defaultCategory: 'Dom i remont' },
  { pattern: /\bobi\b/i, name: 'OBI', defaultCategory: 'Dom i remont' },
  { pattern: /\bikea\b/i, name: 'IKEA', defaultCategory: 'Dom i remont' },
  { pattern: /\bmedia\s*expert/i, name: 'Media Expert', defaultCategory: 'Elektronika' },
  { pattern: /\brtv\s*euro\s*agd/i, name: 'RTV Euro AGD', defaultCategory: 'Elektronika' },
  { pattern: /\bpepco\b/i, name: 'Pepco', defaultCategory: 'Dom i odzież' },
  { pattern: /\baction\b/i, name: 'Action', defaultCategory: 'Dom i ogród' },
];

const ITEM_CATEGORIES: Array<{ category: string; pattern: RegExp }> = [
  { category: 'Paliwo i auto', pattern: /\b(paliwo|benzyna|diesel|on\b|pb95|pb98|lpg|verva|efect|myjnia|p[łl]yn\s+do\s+sprysk)/i },
  { category: 'Zdrowie i higiena', pattern: /\b(lek\b|apap|ibuprom|ketonal|cetigran|magne|essentiale|witamina|syrop|tabl|kaps|ma[śs][ćc]|pasta\s+do|szczotecz|szampon|myd[łl]o|żel|dezodorant|chustecz)/i },
  { category: 'Dom i remont', pattern: /\b(farba|klej|[śs]rub|wkr[ęe]t|żar[óo]wk|bateria|kabel|r[ęe]cznik|papier\s+toalet|proszek|kapsu[łl]ki|p[łl]yn\s+do\s+naczy|g[ąa]bk|torb[ay]\s+papierow)/i },
  { category: 'Spożywcze', pattern: /\b(chleb|bu[łl]k|mleko|mas[łl]o|ser\b|jogurt|jaj|mi[ęe]so|kurczak|szynk|kie[łl]bas|pomidor|og[óo]r|ziemniak|jab[łl]k|banan|woda|sok\b|kawa|herbata|cukier|m[ąa]ka|makaron|ry[żz]|olej|czekolad|ciast)/i },
];

const IGNORE_LINE_RE = /(?:podsum|\bsuma\b|\brazem\b|\bptu\b|\bvat\b|sp\.?\s*op|sprzeda[żz]\s+opodatkowana|niefiskalny|\breszta\b|\bkarta\b|got[óo]wka|zap[łl]acono|do\s+zap[łl]aty|\brabat\b|\bopust\b|\bupust\b|\bnip\b|\bkasa\b|\bkasjer\b|nr\s*sys|nr\s*dok|paragon\s+fiskalny|bez\s+recepty|na\s+recept[ęe]|odp[łl]atno[śs][ćc]|\bnetto\b|\bbrutto\b|warto[śs][ćc]|autoryzacj|transakcj)/i;
const END_BODY_RE = /\b(sp\.?\s*op|sprzeda[żz]\s+opodatkowana|podsumowanie|podsuma|suma\s+pln|suma\s+ptu|razem\s+pln|ptu\s+[a-d])\b/i;

function classifyItem(name: string, storeDefault?: string): string {
  for (const rule of ITEM_CATEGORIES) {
    if (rule.pattern.test(name)) return rule.category;
  }
  return storeDefault || 'Inne';
}

function detectMerchant(lines: string[], fullText: string): { name: string | null; defaultCategory?: string } {
  const headerText = lines.slice(0, 12).join('\n');
  for (const store of KNOWN_STORES) {
    if (store.pattern.test(headerText)) return { name: store.name, defaultCategory: store.defaultCategory };
  }
  if (/\b(bez\s+recepty|na\s+recept[ęe])\b/i.test(fullText)) {
    return { name: 'Apteka', defaultCategory: 'Zdrowie i higiena' };
  }
  for (const line of lines.slice(0, 6)) {
    const clean = line.trim();
    if (
      clean.length >= 3 &&
      clean.length <= 48 &&
      !/\b(nip|ul\.|tel|paragon|data|\d{2}-\d{3}|\d{4}-\d{2}-\d{2})\b/i.test(clean) &&
      /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,}/.test(clean)
    ) {
      return { name: clean };
    }
  }
  return { name: null };
}

function parsePriceToCents(raw: string): number | null {
  const normalized = raw.replace(/[\s\u00A0]+/g, '').replace(',', '.');
  const val = Number.parseFloat(normalized);
  if (!Number.isFinite(val) || val <= 0 || val > 500_000) return null;
  return Math.round(val * 100);
}

function cleanProductName(raw: string): string {
  return raw
    .replace(/\s*[.\s]\d{3,5}[A-Da-d]?$/i, '')
    .replace(/[x×*]\s*$/, '')
    .trim()
    .slice(0, 80);
}

/** Extracts store name, total amount, payment status, and purchased line items from receipt OCR text. */
export function parseReceiptFromOcr(text: string): ParsedReceipt {
  if (!text || typeof text !== 'string') {
    return { isReceipt: false, merchantName: null, amountCents: null, paymentStatus: null, items: [] };
  }

  const isReceipt = /\b(paragon\s+fiskalny|suma\s+pln|sp\.?\s*op\.?|sprzeda[żz]\s+opodatkowana|ptu\s*[a-d]|bez\s+recepty)\b/i.test(text);
  if (!isReceipt) {
    return { isReceipt: false, merchantName: null, amountCents: null, paymentStatus: null, items: [] };
  }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const merchant = detectMerchant(lines, text);

  let amountCents: number | null = null;
  const sumMatches = Array.from(
    text.matchAll(/\b(?:suma\s*(?:pln)?|razem\s*(?:pln)?|do\s+zap[łl]aty(?:\s+pln)?)\s*[:\-\r\n]*\s*((?:\d{1,3}(?:[\s\u00A0]\d{3})+|\d{1,6})[.,]\d{2})/gi),
  );
  const lastSum = sumMatches.length ? sumMatches[sumMatches.length - 1]?.[1] : undefined;
  if (lastSum) amountCents = parsePriceToCents(lastSum);

  const items: ParsedReceiptItem[] = [];
  let inBody = !/paragon\s+fiskalny/i.test(text);
  let pendingName: string | null = null;

  for (const line of lines) {
    if (/paragon\s+fiskalny/i.test(line)) { inBody = true; pendingName = null; continue; }
    if (inBody && END_BODY_RE.test(line)) break;
    if (!inBody || IGNORE_LINE_RE.test(line)) { pendingName = null; continue; }

    // Two-line format: line 2 contains only quantity x unitPrice total[VAT] (e.g. "1 x1 299,00 1 299,00A")
    const qtyPriceOnly = line.match(/^(\d+(?:[.,]\d{1,3})?)\s*(?:szt\.?|kg|l)?\s*[x×*]\s*(?:\d{1,3}(?:[\s\u00A0]\d{3})+|\d{1,6})[.,]\d{2}\s+((?:\d{1,3}(?:[\s\u00A0]\d{3})+|\d{1,6})[.,]\d{2})\s*\*?\s*[A-Da-d]?$/);
    if (qtyPriceOnly && pendingName) {
      const totalCents = parsePriceToCents(qtyPriceOnly[2]);
      const qtyRaw = Number.parseFloat(qtyPriceOnly[1].replace(',', '.'));
      if (totalCents !== null) {
        items.push({
          name: pendingName,
          quantity: Number.isFinite(qtyRaw) && qtyRaw > 0 && qtyRaw <= 1000 ? qtyRaw : 1,
          totalCents,
          category: classifyItem(pendingName, merchant.defaultCategory),
        });
      }
      pendingName = null;
      continue;
    }

    // Single-line format: "Chleb wiejski 5,99A" or "Telewizor OLED 1 x 3 499,00 3 499,00 A"
    const singleLine = line.match(/^(.{2,65}?)\s+(?:(\d+(?:[.,]\d{1,3})?)\s*(?:szt\.?|kg|l)?\s*[x×*]\s*(?:\d{1,3}(?:[\s\u00A0]\d{3})+|\d{1,6})[.,]\d{2}\s+)?((?:\d{1,3}(?:[\s\u00A0]\d{3})+|\d{1,6})[.,]\d{2})\s*\*?\s*[A-Da-d]?$/);
    if (singleLine) {
      const name = cleanProductName(singleLine[1]);
      const totalCents = parsePriceToCents(singleLine[3]);
      if (name.length >= 2 && /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{2,}/.test(name) && !/[=]$/.test(name) && totalCents !== null) {
        const qtyRaw = singleLine[2] ? Number.parseFloat(singleLine[2].replace(',', '.')) : 1;
        items.push({
          name,
          quantity: Number.isFinite(qtyRaw) && qtyRaw > 0 && qtyRaw <= 1000 ? qtyRaw : 1,
          totalCents,
          category: classifyItem(name, merchant.defaultCategory),
        });
        pendingName = null;
        continue;
      }
    }

    // Otherwise treat descriptive line as potential item name for the next quantity/price line
    const candidate = cleanProductName(line);
    if (candidate.length >= 3 && /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{2,}/.test(candidate) && !/^\d{4}[.\-/]\d{2}[.\-/]\d{2}/.test(line)) {
      pendingName = candidate;
    } else {
      pendingName = null;
    }
  }

  if (amountCents === null && items.length > 0) {
    amountCents = items.reduce((sum, i) => sum + i.totalCents, 0);
  }

  return {
    isReceipt,
    merchantName: merchant.name,
    amountCents,
    paymentStatus: isReceipt ? 'paid' : null,
    items: items.slice(0, 120),
  };
}
