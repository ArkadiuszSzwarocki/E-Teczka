export type ExtractedFinance = {
  amountCents: number | null;
  currency: string;
  dueDate: Date | null;
};

const STRICT_AMOUNT_PATTERN =
  /(?:razem\s+do\s+zap[łl]aty|do\s+zap[łl]aty|kwota\s+do\s+zap[łl]aty|pozosta[łl]o\s+do\s+zap[łl]aty|suma\s+brutto|warto[śs][ćc]\s+brutto|kwota\s+brutto|należność\s+og[óo][łl]em|nale[żz]no[śs][ćc]\s+do\s+zap[łl]aty|amount\s+due)\s*[:\-]?\s*(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s*(pln|z[łl]|eur|usd)?/gi;

const GENERAL_TOTAL_PATTERN =
  /(?:razem|suma|total)\s*[:\-]?\s*(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s*(pln|z[łl]|eur|usd)?/gi;

const BILLABLE_DOC_RE =
  /\b(faktura(?:\s+vat)?|rachunek|paragon(?:\s+fiskalny)?|nota\s+(?:ksi[ęe]gowa|obci[ąa][żz]eniowa)|wezwanie\s+do\s+zap[łl]aty|polecenie\s+przelewu|rozliczenie\s+zu[żz]ycia|invoice|receipt|amount\s+due|do\s+zap[łl]aty|termin\s+p[łl]atno[śs]ci)\b/i;

const NON_BILLABLE_DOC_RE =
  /\b(umowa|za[łl][ąa]cznik(?:i)?\s+do\s+umowy|regulamin|tabela\s+op[łl]at|tabela\s+prowizji|taryfa\s+op[łl]at|og[óo]lne\s+warunki|polityka\s+prywatno[śs]ci|deklaracja\s+przyst[ąa]pienia|pe[łl]nomocnictwo|aneks\s+do\s+umowy|pakiet\s+dokument[óo]w)\b/i;

const DUE_DATE_PATTERNS = [
  /(?:termin\s+p[łl]atno[śs]ci|p[łl]atne\s+do|termin\s+zap[łl]aty|data\s+wa[żz]no[śs]ci|wa[żz]ne\s+do|due\s+date)\s*[:\-]?\s*(\d{4}[.\-/]\d{2}[.\-/]\d{2}|\d{2}[.\-/]\d{2}[.\-/]\d{4})/i,
];

function parseAmountToCents(raw: string): number | null {
  const normalized = raw.replace(/[\s\u00A0]/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  return Math.round(value * 100);
}

function parseDateToken(token: string): Date | null {
  const isoMatch = token.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (isoMatch) {
    const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const plMatch = token.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
  if (plMatch) {
    const parsed = new Date(`${plMatch[3]}-${plMatch[2]}-${plMatch[1]}T12:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function extractLastAmount(text: string, pattern: RegExp): { amountCents: number; currency: string } | null {
  pattern.lastIndex = 0;
  let result: { amountCents: number; currency: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const cents = parseAmountToCents(match[1]);
    if (cents === null) continue;
    const unit = (match[2] || '').toUpperCase();
    const currency = unit === 'EUR' || unit === 'USD' ? unit : 'PLN';
    result = { amountCents: cents, currency };
  }
  return result;
}

/** Extracts invoice/receipt total amount and payment/validity due date from OCR text. */
export function extractFinanceFromOcr(text: string, title = ''): ExtractedFinance {
  if (!text || typeof text !== 'string') return { amountCents: null, currency: 'PLN', dueDate: null };
  const headerSample = `${title}\n${text.slice(0, 2500)}`;
  const isBillable = BILLABLE_DOC_RE.test(headerSample);
  const isNonBillable = NON_BILLABLE_DOC_RE.test(headerSample);

  let amountCents: number | null = null;
  let currency = 'PLN';

  // Skip amount extraction on contracts, regulations, fee schedules, and attachments unless explicitly a billable invoice/receipt.
  if (!isNonBillable || /\b(faktura(?:\s+vat)?|paragon(?:\s+fiskalny)?|rachunek|wezwanie\s+do\s+zap[łl]aty)\b/i.test(headerSample)) {
    const strict = extractLastAmount(text, STRICT_AMOUNT_PATTERN);
    if (strict) {
      amountCents = strict.amountCents;
      currency = strict.currency;
    } else if (isBillable) {
      const general = extractLastAmount(text, GENERAL_TOTAL_PATTERN);
      if (general) {
        amountCents = general.amountCents;
        currency = general.currency;
      }
    }
  }

  let dueDate: Date | null = null;
  for (const pattern of DUE_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      dueDate = parseDateToken(match[1]);
      if (dueDate) break;
    }
  }

  return { amountCents, currency, dueDate };
}
