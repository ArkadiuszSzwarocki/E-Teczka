import type { LearnedBoost } from './folderLearningStore';

export type FolderCandidate = {
  id: number;
  name: string;
  parentId: number | null;
};

export type FolderSuggestion = {
  folderId: number;
  folderName: string;
  score: number;
  reason: string;
};

export type DocumentClassificationResult = {
  detectedType: string;
  detectedLabel: string;
  suggestedTitle: string | null;
  suggestions: FolderSuggestion[];
};

type CategoryRule = {
  type: string;
  label: string;
  patterns: RegExp[];
  folderHints: string[];
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    type: 'terms_privacy',
    label: 'Regulamin / Polityka prywatności',
    patterns: [
      /(?:^|[\s_.-])regulamin(?:y|ów|u|em|ie)?(?:$|[\s_.-])/i,
      /(?:^|[\s_.-])polityk[aęi][\s_-]+prywatno[śs]c(?:i|ią)?/i,
      /(?:^|[\s_.-])privacy[\s_-]*policy/i,
      /\brodo\b/i,
      /\bklauzula\s+informacyjna\b/i,
      /\bwarunki\s+(świadczenia\s+usług|serwisu|korzystania)\b/i,
    ],
    folderHints: ['regulaminy', 'polityka prywatności', 'prawne', 'rodo', 'umowy', 'instrukcje'],
  },
  {
    type: 'utility',
    label: 'Media / Abonament',
    patterns: [/\b(pge|tauron|energa|enea|pgnig|orange|t-mobile|play|plus|vectra|upc|netia|wodociągi|czynsz)\b/i, /\b(energia elektryczna|zużycie|abonament|taryfa|licznik)\b/i],
    folderHints: ['media', 'abonament', 'rachunki', 'dom', 'mieszkanie', 'prąd', 'gaz', 'internet'],
  },
  {
    type: 'invoice',
    label: 'Faktura',
    patterns: [/\bfaktura(\s+vat)?\b/i, /\bnr\s*fv\b/i, /\bnip\b/i, /\bdo zapłaty\b/i, /\btermin płatności\b/i],
    folderHints: ['faktury', 'rachunki', 'firma', 'koszty', 'zakupy'],
  },
  {
    type: 'receipt',
    label: 'Paragon',
    patterns: [/\bparagon\s+fiskalny\b/i, /\bniefiskalny\b/i, /\bptu\s+[a-z]\b/i, /\bsuma\s+pln\b/i],
    folderHints: ['zakupy', 'paragony', 'rachunki', 'faktury', 'gwarancje'],
  },
  {
    type: 'contract',
    label: 'Umowa / Aneks',
    patterns: [/\bumowa\b/i, /\baneks\b/i, /\bstrony umowy\b/i, /§\s*\d+/],
    folderHints: ['umowy', 'praca', 'najem', 'notarialne', 'firma'],
  },
  {
    type: 'tax_office',
    label: 'Urząd / Podatki',
    patterns: [/\b(zus|pit-\d+|cit|vat-\d+|urząd skarbowy|naczelnik|decyzja|wezwanie|zaświadczenie)\b/i],
    folderHints: ['urzędy', 'podatki', 'świadczenia', 'firma', 'osobiste'],
  },
  {
    type: 'insurance',
    label: 'Ubezpieczenie / Polisa',
    patterns: [/\b(polisa|ubezpieczeni|składka|ochrona|pzu|warta|ergo hestia|allianz|link4|oc\/ac)\b/i],
    folderHints: ['ubezpieczenia', 'samochód', 'dom', 'zdrowie'],
  },
  {
    type: 'medical',
    label: 'Dokument medyczny',
    patterns: [/\b(wynik badania|recepta|skierowanie|szpital|przychodnia|diagnoza|lek\.|karta informacyjna)\b/i],
    folderHints: ['zdrowie', 'lekarz', 'dzieci', 'osobiste'],
  },
  {
    type: 'car',
    label: 'Pojazd / Serwis',
    patterns: [/\b(vin|dowód rejestracyjny|przegląd techniczny|stacja kontroli|warsztat|wymiana opon|olej)\b/i],
    folderHints: ['samochód', 'serwis', 'ubezpieczenia'],
  },
  {
    type: 'warranty',
    label: 'Gwarancja / Instrukcja',
    patterns: [/\b(karta gwarancyjna|gwarancja|rękojmia|instrukcja obsługi|reklamacja)\b/i],
    folderHints: ['gwarancje', 'reklamacje', 'instrukcje', 'zakupy', 'serwis'],
  },
];

function normalizePl(value: string): string {
  return value.toLocaleLowerCase('pl').normalize('NFKC');
}

function buildFolderPath(folderId: number, folderMap: Map<number, FolderCandidate>): string {
  const parts: string[] = [];
  let current = folderMap.get(folderId);
  let guard = 0;
  while (current && guard < 20) {
    parts.unshift(current.name);
    current = current.parentId !== null ? folderMap.get(current.parentId) : undefined;
    guard++;
  }
  return parts.join(' / ');
}

function extractSuggestedTitle(ocrText: string, label: string): string | null {
  const lines = ocrText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 3);
  if (lines.length === 0) return null;
  const firstMeaningful = lines.find(line => !/^\d+([.,/-]\d+)*$/.test(line)) || lines[0];
  const compact = firstMeaningful.replace(/\s+/g, ' ').slice(0, 60).trim();
  if (!compact) return null;
  return compact.toLocaleLowerCase('pl').includes(label.split(' ')[0].toLocaleLowerCase('pl'))
    ? compact
    : `${label} — ${compact}`.slice(0, 80);
}

/** Deterministically classifies OCR text offline and ranks matching user folders without any external AI. */
export function classifyDocumentOffline(
  ocrText: string,
  folders: FolderCandidate[],
  learnedBoosts?: Map<number, LearnedBoost>,
): DocumentClassificationResult {
  const normalized = normalizePl(ocrText || '');
  let bestRule: CategoryRule | null = null;
  let bestHits = 0;

  for (const rule of CATEGORY_RULES) {
    const hits = rule.patterns.reduce((sum, re) => sum + (re.test(normalized) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      bestRule = rule;
    }
  }

  const detectedType = bestRule?.type ?? 'other';
  const detectedLabel = bestRule?.label ?? 'Dokument ogólny';
  const folderMap = new Map(folders.map(f => [f.id, f]));

  const ranked: FolderSuggestion[] = [];
  for (const folder of folders) {
    const folderNameNorm = normalizePl(folder.name);
    const words = folderNameNorm.split(/[\s,/._-]+/).filter(w => w.length >= 3);
    let score = 0;
    const reasons: string[] = [];

    for (const word of words) {
      if (normalized.includes(word)) {
        score += 3;
        reasons.push(`słowo „${word}” w treści`);
      }
    }

    if (bestRule) {
      for (const hint of bestRule.folderHints) {
        if (folderNameNorm.includes(hint)) {
          score += 5;
          reasons.push(`dopasowanie kategorii: ${detectedLabel}`);
          break;
        }
      }
    }

    const learned = learnedBoosts?.get(folder.id);
    if (learned) {
      score += learned.boost;
      reasons.unshift(learned.reason);
    }

    if (score > 0) {
      ranked.push({
        folderId: folder.id,
        folderName: buildFolderPath(folder.id, folderMap),
        score,
        reason: reasons[0] || detectedLabel,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score || a.folderName.localeCompare(b.folderName, 'pl'));

  return {
    detectedType,
    detectedLabel,
    suggestedTitle: extractSuggestedTitle(ocrText, detectedLabel),
    suggestions: ranked.slice(0, 4),
  };
}
