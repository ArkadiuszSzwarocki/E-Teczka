export type VatWhitelistResult = {
  nip: string;
  date: string;
  checked: boolean;
  subjectName: string | null;
  statusVat: 'Czynny' | 'Zwolniony' | 'Niezarejestrowany' | string | null;
  isActiveVat: boolean;
  ibanChecked: boolean;
  ibanMatch: boolean | null;
  requestId: string | null;
  error?: string;
};

type CacheEntry = { result: VatWhitelistResult; expiresAt: number };
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

function normalizeAccount(raw?: string | null): string {
  const clean = String(raw || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return clean.startsWith('PL') ? clean.slice(2) : clean;
}

/**
 * Verifies a Polish taxpayer NIP and optional 26-digit bank account against the official free
 * Ministry of Finance VAT Whitelist API (https://wl-api.mf.gov.pl).
 */
export async function checkVatWhitelist(rawNip: string, rawIban?: string | null, rawDate?: string | null): Promise<VatWhitelistResult> {
  const nip = rawNip.replace(/[^0-9]/g, '');
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())
    ? rawDate.trim()
    : new Date().toISOString().slice(0, 10);
  const nrb = normalizeAccount(rawIban);
  const hasValidNrb = /^\d{26}$/.test(nrb);

  if (!/^\d{10}$/.test(nip)) {
    return {
      nip,
      date,
      checked: false,
      subjectName: null,
      statusVat: null,
      isActiveVat: false,
      ibanChecked: false,
      ibanMatch: null,
      requestId: null,
      error: 'Nieprawidłowy numer NIP (wymagane 10 cyfr).',
    };
  }

  const cacheKey = `${nip}:${date}:${hasValidNrb ? nrb : ''}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${date}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        nip,
        date,
        checked: false,
        subjectName: null,
        statusVat: null,
        isActiveVat: false,
        ibanChecked: hasValidNrb,
        ibanMatch: null,
        requestId: null,
        error: `API Białej Listy MF chwilowo niedostępne (HTTP ${response.status}).`,
      };
    }

    const payload = (await response.json()) as {
      result?: {
        requestId?: string;
        subject?: {
          name?: string;
          statusVat?: string;
          accountNumbers?: string[];
        } | null;
      };
    };
    const subject = payload.result?.subject || null;
    const statusVat = subject?.statusVat ?? 'Niezarejestrowany';
    const accounts = Array.isArray(subject?.accountNumbers)
      ? subject!.accountNumbers.map(a => normalizeAccount(a))
      : [];

    const result: VatWhitelistResult = {
      nip,
      date,
      checked: true,
      subjectName: subject?.name || null,
      statusVat,
      isActiveVat: statusVat === 'Czynny',
      ibanChecked: hasValidNrb,
      ibanMatch: hasValidNrb ? accounts.includes(nrb) : null,
      requestId: payload.result?.requestId || null,
    };

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch {
    return {
      nip,
      date,
      checked: false,
      subjectName: null,
      statusVat: null,
      isActiveVat: false,
      ibanChecked: hasValidNrb,
      ibanMatch: null,
      requestId: null,
      error: 'Nie udało się połączyć z API Białej Listy MF.',
    };
  } finally {
    clearTimeout(timer);
  }
}
