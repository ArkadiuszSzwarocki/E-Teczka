export type RodoRegion = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  page?: number;
};

export const RODO_REGIONS_KEY = 'mojateczka_rodo_regions_v1';
export const RODO_PHRASES_KEY = 'mojateczka_rodo_phrases_v1';
export const RODO_UNLOCK_EVENT = 'mojateczka-rodo-unlock-changed';
export const RODO_UNLOCK_DURATION_MS = 180_000;

const unlockExpirations = new Map<number, number>();

/** Unlocks RODO protection for a document for 3 minutes and notifies listeners. */
export function unlockDocumentRodo(docId?: number, durationMs = RODO_UNLOCK_DURATION_MS): void {
  if (!docId) return;
  unlockExpirations.set(docId, Date.now() + durationMs);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RODO_UNLOCK_EVENT));
}

/** Returns remaining unlock seconds (> 0) for a document, or 0 if locked/expired. */
export function getDocumentRodoUnlockRemainingSeconds(docId?: number): number {
  if (!docId) return 0;
  const expiresAt = unlockExpirations.get(docId);
  if (!expiresAt) return 0;
  const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
  if (remaining <= 0) {
    unlockExpirations.delete(docId);
    return 0;
  }
  return remaining;
}

function readAllRegions(): Record<string, RodoRegion[]> {
  try {
    const raw = localStorage.getItem(RODO_REGIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, RodoRegion[]>)
      : {};
  } catch {
    return {};
  }
}

function writeAllRegions(map: Record<string, RodoRegion[]>): void {
  try {
    localStorage.setItem(RODO_REGIONS_KEY, JSON.stringify(map));
  } catch { /* ignore storage errors */ }
}

/** Returns manual RODO redaction boxes (in 0..100% coordinates) saved for a document. */
export function getDocumentRodoRegions(docId?: number): RodoRegion[] {
  if (!docId) return [];
  const list = readAllRegions()[String(docId)];
  return Array.isArray(list) ? list : [];
}

/** Appends a manual RODO redaction box to a document and returns the updated list. */
export function addDocumentRodoRegion(docId: number, region: Omit<RodoRegion, 'id'>): RodoRegion[] {
  const all = readAllRegions();
  const key = String(docId);
  const current = Array.isArray(all[key]) ? all[key] : [];
  const nextItem: RodoRegion = {
    ...region,
    id: `rodo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    x: Math.max(0, Math.min(100, Number(region.x.toFixed(2)))),
    y: Math.max(0, Math.min(100, Number(region.y.toFixed(2)))),
    w: Math.max(1, Math.min(100, Number(region.w.toFixed(2)))),
    h: Math.max(1, Math.min(100, Number(region.h.toFixed(2)))),
  };
  const updated = [...current, nextItem];
  all[key] = updated;
  writeAllRegions(all);
  return updated;
}

/** Removes a single manual RODO redaction box from a document. */
export function removeDocumentRodoRegion(docId: number, regionId: string): RodoRegion[] {
  const all = readAllRegions();
  const key = String(docId);
  const current = Array.isArray(all[key]) ? all[key] : [];
  const updated = current.filter(item => item.id !== regionId);
  if (updated.length > 0) all[key] = updated;
  else delete all[key];
  writeAllRegions(all);
  return updated;
}

function readAllPhrases(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(RODO_PHRASES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string[]>)
      : {};
  } catch {
    return {};
  }
}

/** Returns user-selected OCR text phrases marked as RODO for a document. */
export function getDocumentRodoPhrases(docId?: number): string[] {
  if (!docId) return [];
  const list = readAllPhrases()[String(docId)];
  return Array.isArray(list) ? list : [];
}

/** Saves a selected OCR text fragment to mask with [RODO] for a document. */
export function addDocumentRodoPhrase(docId: number, phrase: string): string[] {
  const trimmed = phrase.trim();
  if (!trimmed) return getDocumentRodoPhrases(docId);
  const all = readAllPhrases();
  const key = String(docId);
  const current = Array.isArray(all[key]) ? all[key] : [];
  if (current.includes(trimmed)) return current;
  const updated = [...current, trimmed];
  all[key] = updated;
  try { localStorage.setItem(RODO_PHRASES_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return updated;
}

/** Removes a custom RODO phrase from a document. */
export function removeDocumentRodoPhrase(docId: number, phrase: string): string[] {
  const all = readAllPhrases();
  const key = String(docId);
  const current = Array.isArray(all[key]) ? all[key] : [];
  const updated = current.filter(item => item !== phrase);
  if (updated.length > 0) all[key] = updated;
  else delete all[key];
  try { localStorage.setItem(RODO_PHRASES_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  return updated;
}

/** Masks user-selected OCR text phrases with compact mosaic block characters. */
export function maskCustomRodoPhrases(text: string, phrases: string[]): string {
  if (!text || phrases.length === 0) return text;
  let result = text;
  for (const phrase of phrases) {
    if (!phrase) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement = phrase.replace(/[^\s]/g, '▪');
    result = result.replace(new RegExp(escaped, 'g'), replacement);
  }
  return result;
}
