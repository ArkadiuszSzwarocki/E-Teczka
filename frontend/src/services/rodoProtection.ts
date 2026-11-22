export type RodoCategory =
  | 'pesel'
  | 'id_card'
  | 'nip'
  | 'bank_account'
  | 'payment_card'
  | 'full_name'
  | 'address'
  | 'contact'
  | 'medical';

export type RodoDocOverride = 'auto' | 'always' | 'never';

export type RodoCategoryMeta = {
  id: RodoCategory;
  label: string;
  tag: string;
  description: string;
};

export const RODO_CATEGORIES: readonly RodoCategoryMeta[] = [
  { id: 'pesel', label: 'PESEL', tag: 'PESEL', description: '11-cyfrowe numery PESEL' },
  { id: 'id_card', label: 'Dowód / Paszport', tag: 'DOKUMENT TOŻSAMOŚCI', description: 'Serie i numery dokumentów tożsamości' },
  { id: 'nip', label: 'NIP', tag: 'NIP', description: 'Numery identyfikacji podatkowej NIP' },
  { id: 'bank_account', label: 'Konto bankowe', tag: 'KONTO BANKOWE', description: 'Numery rachunków IBAN / NRB' },
  { id: 'payment_card', label: 'Karta płatnicza', tag: 'KARTA', description: '16-cyfrowe numery kart płatniczych' },
  { id: 'full_name', label: 'Imię i nazwisko', tag: 'IMIĘ I NAZWISKO', description: 'Dane osobowe przy etykietach (np. Pan/Pani, Wnioskodawca, Podpis)' },
  { id: 'address', label: 'Adres zamieszkania', tag: 'ADRES', description: 'Ulice (ul./al./os.), kody pocztowe i miejscowości' },
  { id: 'contact', label: 'Telefon / E-mail', tag: 'KONTAKT', description: 'Adresy e-mail i numery telefonów' },
  { id: 'medical', label: 'Dane medyczne (art. 9)', tag: 'DANE MEDYCZNE', description: 'Rozpoznanie, recepta, skierowanie, ICD-10, leczenie' },
] as const;

export const RODO_CATEGORIES_KEY = 'eteczka_rodo_categories_v1';
export const RODO_SMART_KEY = 'eteczka_rodo_smart_v1';
const RODO_OVERRIDES_KEY = 'eteczka_rodo_doc_overrides_v1';
export const RODO_CHANGED_EVENT = 'eteczka-masking-changed';

const ALL_CATEGORY_IDS: RodoCategory[] = RODO_CATEGORIES.map(c => c.id);
const CATEGORY_TAG_MAP = new Map<RodoCategory, string>(RODO_CATEGORIES.map(c => [c.id, c.tag]));
const CATEGORY_LABEL_MAP = new Map<RodoCategory, string>(RODO_CATEGORIES.map(c => [c.id, c.label]));

export function getRodoCategories(): RodoCategory[] {
  try {
    const raw = localStorage.getItem(RODO_CATEGORIES_KEY);
    if (!raw) return [...ALL_CATEGORY_IDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...ALL_CATEGORY_IDS];
    return parsed.filter((item): item is RodoCategory => CATEGORY_TAG_MAP.has(item as RodoCategory));
  } catch {
    return [...ALL_CATEGORY_IDS];
  }
}

export function setRodoCategories(categories: RodoCategory[]): void {
  const unique = Array.from(new Set(categories.filter(c => CATEGORY_TAG_MAP.has(c))));
  try {
    localStorage.setItem(RODO_CATEGORIES_KEY, JSON.stringify(unique));
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RODO_CHANGED_EVENT));
}

export function getRodoSmartDetectionEnabled(): boolean {
  try {
    return localStorage.getItem(RODO_SMART_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRodoSmartDetectionEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(RODO_SMART_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RODO_CHANGED_EVENT));
}

function readOverrides(): Record<string, RodoDocOverride> {
  try {
    const raw = localStorage.getItem(RODO_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, RodoDocOverride>) : {};
  } catch {
    return {};
  }
}

export function getDocumentRodoOverride(docId?: number): RodoDocOverride {
  if (!docId) return 'auto';
  const val = readOverrides()[String(docId)];
  return val === 'always' || val === 'never' ? val : 'auto';
}

export function setDocumentRodoOverride(docId: number, mode: RodoDocOverride): void {
  const current = readOverrides();
  if (mode === 'auto') delete current[String(docId)];
  else current[String(docId)] = mode;
  try {
    localStorage.setItem(RODO_OVERRIDES_KEY, JSON.stringify(current));
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RODO_CHANGED_EVENT));
}

const CATEGORY_PATTERNS: Record<RodoCategory, RegExp[]> = {
  pesel: [/\b\d{11}\b/g],
  id_card: [/\b[A-Z]{3}\s?\d{6}\b/g, /\b[A-Z]{2}\s?\d{7}\b/g],
  nip: [/\bNIP[:\s-]*(?:\d[\s-]?){10}\b/gi],
  bank_account: [/\b(?:PL\s?)?(?:\d[\s-]?){26}\b/gi],
  payment_card: [/\b(?:\d{4}[\s-]?){3}\d{4}\b/g],
  full_name: [
    /\b(?:Imię i nazwisko|Imie i nazwisko|Pan|Pani|Wnioskodawca|Pacjent|Wystawca|Lekarz|Klient|Zamawiający|Właściciel|Podpis|Odbiorca|Nadawca)\s*[:-]?\s*(?:[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{1,25}|[A-ZĄĆĘŁŃÓŚŹŻ]{2,25})\s+(?:[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{1,30}|[A-ZĄĆĘŁŃÓŚŹŻ]{2,30})(?:-(?:[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{1,30}|[A-ZĄĆĘŁŃÓŚŹŻ]{2,30}))?/g,
  ],
  address: [
    /\b(?:ul\.|al\.|os\.|pl\.)\s*[A-ZĄĆĘŁŃÓŚŹŻ0-9][^\n,;]{2,45}\s+\d+[A-Za-z]?(?:\/\d+)?/gi,
    /\b\d{2}-\d{3}\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{2,30}(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{2,20})?/g,
  ],
  contact: [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    /(?:\+48[\s-]?)?\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    /\(\d{2}\)\s?\d{3}[\s-]?\d{2}[\s-]?\d{2}|\(\d{2}\)\s?\d{7}/g,
  ],
  medical: [
    /\b(?:rozpoznanie|diagnoza|recepta|e-?recepta|erecepta|skierowanie|hospitalizacja|ICD-10|zaświadczenie lekarskie|karta informacyjna leczenia|wynik badania|dawkowanie|PWZ|pacjent|lekarz|odpłatność|tabletki)\b/gi,
  ],
};

function testRegexFresh(pattern: RegExp, text: string): boolean {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  return re.test(text);
}

/** Detects which RODO categories appear in the supplied document text. */
export function detectRodoMatches(
  text: string,
  categories: RodoCategory[] = getRodoCategories(),
): { matchedCategories: RodoCategory[]; labels: string[]; count: number } {
  if (!text || !text.trim() || categories.length === 0) {
    return { matchedCategories: [], labels: [], count: 0 };
  }
  const matched: RodoCategory[] = [];
  for (const cat of categories) {
    const patterns = CATEGORY_PATTERNS[cat];
    if (patterns.some(p => testRegexFresh(p, text))) matched.push(cat);
  }
  return {
    matchedCategories: matched,
    labels: matched.map(cat => CATEGORY_LABEL_MAP.get(cat) || cat),
    count: matched.length,
  };
}

/** Replaces detected RODO personal/sensitive spans in OCR text with explicit [RODO: ...] tags. */
export function maskRodoText(text: string, categories: RodoCategory[] = getRodoCategories()): string {
  if (!text || categories.length === 0) return text;
  let masked = text;
  const order: RodoCategory[] = ['bank_account', 'payment_card', 'pesel', 'nip', 'id_card', 'address', 'contact', 'full_name', 'medical'];
  for (const cat of order) {
    if (!categories.includes(cat)) continue;
    const tag = `[RODO: ${CATEGORY_TAG_MAP.get(cat) || 'DANE'}]`;
    for (const pattern of CATEGORY_PATTERNS[cat]) {
      const re = new RegExp(pattern.source, pattern.flags);
      masked = masked.replace(re, tag);
    }
  }
  return masked;
}

export type DocumentProtectionDecision = {
  protect: boolean;
  reason: 'disabled' | 'manual_always' | 'manual_never' | 'smart_disabled' | 'detected' | 'no_rodo_data';
  matchedLabels: string[];
};

/** Determines whether a document requires PIN/password/TOTP protection based on user RODO settings and OCR text. */
export function shouldProtectDocument(params: {
  docId?: number;
  title?: string;
  ocrText?: string | null;
  maskingEnabled: boolean;
  categories?: RodoCategory[];
  smartEnabled?: boolean;
}): DocumentProtectionDecision {
  if (!params.maskingEnabled) return { protect: false, reason: 'disabled', matchedLabels: [] };
  const override = getDocumentRodoOverride(params.docId);
  if (override === 'always') return { protect: true, reason: 'manual_always', matchedLabels: ['Ochrona ręczna'] };
  if (override === 'never') return { protect: false, reason: 'manual_never', matchedLabels: [] };
  const smart = params.smartEnabled ?? getRodoSmartDetectionEnabled();
  if (!smart) return { protect: true, reason: 'smart_disabled', matchedLabels: [] };
  const combined = `${params.title || ''}\n${params.ocrText || ''}`;
  const detected = detectRodoMatches(combined, params.categories);
  if (detected.count > 0) return { protect: true, reason: 'detected', matchedLabels: detected.labels };
  return { protect: false, reason: 'no_rodo_data', matchedLabels: [] };
}
