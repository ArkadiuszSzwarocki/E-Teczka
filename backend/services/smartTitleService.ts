type SmartTitleInput = {
  currentTitle: string;
  merchantName?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  dueDate?: Date | null;
  expiryLabel?: string | null;
  ocrText?: string;
};

const GENERIC_TITLE_PATTERN =
  /^(?:img|pxl|dsc|dcim|mvimg|vid|scan|skan|schowek|photo|zdj[eę]cie|screenshot|zrzut|whatsapp[\s_-]*image|dokument|document|receipt|paragon|file|plik|image|obraz|capture|untitled|bez[\s_-]*nazwy|pdf|doc)[\s_\-.0-9a-f]*$/i;

const PURE_ID_PATTERN = /^[\d\s_\-.]{6,}$|^[0-9a-f]{8,}(?:-[0-9a-f]{4,}){1,}$/i;

function stripExtension(title: string): string {
  return title.trim().replace(/\.[a-z0-9]{2,5}$/i, '').trim();
}

/** Returns true only for generic camera/scanner/clipboard filenames that should be auto-titled after OCR. */
export function isGenericDocumentTitle(title: string): boolean {
  const base = stripExtension(title);
  if (!base || base.length <= 2) return true;
  return GENERIC_TITLE_PATTERN.test(base) || PURE_ID_PATTERN.test(base);
}

function formatPlnAmount(cents: number, currency?: string | null): string {
  const value = (cents / 100).toFixed(2).replace('.', ',');
  const cur = (currency || 'PLN').toUpperCase();
  return cur === 'PLN' ? `${value} zł` : `${value} ${cur}`;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Builds a clean deterministic title from OCR metadata without overwriting user-authored names. */
export function suggestSmartDocumentTitle(input: SmartTitleInput): string | null {
  if (!isGenericDocumentTitle(input.currentTitle)) return null;

  const merchant = input.merchantName?.trim().replace(/\s+/g, ' ').slice(0, 48) || '';
  const amount =
    typeof input.amountCents === 'number' && input.amountCents > 0
      ? formatPlnAmount(input.amountCents, input.currency)
      : '';
  const dueIso =
    input.dueDate && !Number.isNaN(input.dueDate.getTime()) ? formatIsoDate(input.dueDate) : '';

  if (input.expiryLabel && dueIso) {
    const parts = [input.expiryLabel, merchant || null, `do ${dueIso}`].filter(Boolean);
    return parts.join(' · ').slice(0, 160);
  }

  const isInvoice = /faktura|fv\s*\/|vat/i.test(input.ocrText || '');
  if (merchant && amount) {
    const prefix = isInvoice ? 'Faktura' : formatIsoDate(new Date());
    return `${prefix} · ${merchant} · ${amount}`.slice(0, 160);
  }

  if (merchant && dueIso) {
    return `${isInvoice ? 'Faktura' : 'Dokument'} · ${merchant} · termin ${dueIso}`.slice(0, 160);
  }

  if (merchant) {
    return `${isInvoice ? 'Faktura' : 'Dokument'} · ${merchant}`.slice(0, 160);
  }

  if (amount) {
    return `${isInvoice ? 'Faktura' : 'Paragon'} · ${formatIsoDate(new Date())} · ${amount}`.slice(0, 160);
  }

  return null;
}
