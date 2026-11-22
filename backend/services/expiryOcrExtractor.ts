export type ExpiryCategory = 'oc_ac' | 'tech_inspection' | 'identity' | 'warranty';

export type ExtractedExpiry = {
  category: ExpiryCategory;
  expiryDate: Date;
  label: string;
};

function parsePolishOrIsoDate(raw: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const pl = /^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/.exec(raw.trim());
  if (pl) {
    const day = Number(pl[1]);
    const month = Number(pl[2]);
    const year = Number(pl[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2099) return null;
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function findDateAfterKeywords(text: string, pattern: RegExp): Date | null {
  const m = pattern.exec(text);
  if (!m?.[1]) return null;
  return parsePolishOrIsoDate(m[1]);
}

const DATE_GROUP = '(\\d{2}[.\\-/]\\d{2}[.\\-/]\\d{4}|\\d{4}-\\d{2}-\\d{2})';

/** Extracts policy, vehicle inspection, ID/passport, or 2-year warranty expiry dates from OCR text. */
export function extractExpiryFromOcr(ocrText: string, title = ''): ExtractedExpiry | null {
  const combined = `${title}\n${ocrText}`;
  const lower = combined.toLowerCase();

  if (/polisa|ubezpieczeni|oc\s*\/\s*ac|autocasco|odpowiedzialno[śs]ci\s+cywilnej/i.test(lower)) {
    const endDate = findDateAfterKeywords(
      combined,
      new RegExp(`(?:okres\\s+ubezpieczenia[^\\n]{0,40}?do|wa[żz]na\\s+do|koniec\\s+ochrony|do\\s+dnia)\\s*:?\\s*${DATE_GROUP}`, 'i'),
    );
    if (endDate) return { category: 'oc_ac', expiryDate: endDate, label: 'Koniec polisy OC/AC' };
  }

  if (/badani[ea]\s+technicz|przegl[ąa]d\s+technicz|stacja\s+kontroli\s+pojazd/i.test(lower)) {
    const nextDate = findDateAfterKeywords(
      combined,
      new RegExp(`(?:nast[ęe]pn(?:y|ego)\\s+termin|termin\\s+kolejnego\\s+badania|wa[żz]ne\\s+do)\\s*:?\\s*${DATE_GROUP}`, 'i'),
    );
    if (nextDate) return { category: 'tech_inspection', expiryDate: nextDate, label: 'Badanie techniczne pojazdu' };
  }

  if (/dow[óo]d\s+osobisty|paszport|prawo\s+jazdy/i.test(lower)) {
    const validUntil = findDateAfterKeywords(
      combined,
      new RegExp(`(?:data\\s+wa[żz]no[śs]ci|wa[żz]ny\\s+do|date\\s+of\\s+expiry)\\s*:?\\s*${DATE_GROUP}`, 'i'),
    );
    if (validUntil) return { category: 'identity', expiryDate: validUntil, label: 'Ważność dokumentu tożsamości' };
  }

  if (/gwarancj|r[ęe]kojmi|media\s*expert|rtv\s*euro|x-kom|komputronik|apple|samsung|bosch|makita/i.test(lower)) {
    const explicit = findDateAfterKeywords(
      combined,
      new RegExp(`(?:gwarancja\\s+do|koniec\\s+gwarancji|wa[żz]no[śs][ćc]\\s+gwarancji)\\s*:?\\s*${DATE_GROUP}`, 'i'),
    );
    if (explicit) return { category: 'warranty', expiryDate: explicit, label: 'Koniec gwarancji' };
    const purchaseDate = findDateAfterKeywords(
      combined,
      new RegExp(`(?:data\\s+zakupu|data\\s+sprzeda[żz]y|data\\s+wystawienia)\\s*:?\\s*${DATE_GROUP}`, 'i'),
    );
    if (purchaseDate) {
      const warrantyEnd = new Date(purchaseDate);
      warrantyEnd.setUTCFullYear(warrantyEnd.getUTCFullYear() + 2);
      return { category: 'warranty', expiryDate: warrantyEnd, label: '2-letnia rękojmia / gwarancja' };
    }
  }

  return null;
}
