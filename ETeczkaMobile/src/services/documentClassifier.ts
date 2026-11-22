import type { MobileLearnedBoost } from './folderLearning';

export type MobileFolderCandidate = {
  id: number;
  name: string;
  parentId?: number | null;
};

export type MobileFolderSuggestion = {
  folderId: number;
  folderName: string;
  score: number;
  reason: string;
};

export type MobileClassificationResult = {
  detectedType: string;
  detectedLabel: string;
  suggestions: MobileFolderSuggestion[];
};

const RULES: Array<{ type: string; label: string; patterns: RegExp[]; hints: string[] }> = [
  {
    type: 'utility',
    label: 'Media / Abonament',
    patterns: [/\b(pge|tauron|energa|enea|pgnig|orange|t-mobile|play|plus|vectra|upc|netia|czynsz)\b/i],
    hints: ['media', 'abonament', 'rachunki', 'dom', 'mieszkanie'],
  },
  {
    type: 'invoice',
    label: 'Faktura',
    patterns: [/\bfaktura(\s+vat)?\b/i, /\bnip\b/i, /\bdo zapłaty\b/i],
    hints: ['faktury', 'rachunki', 'firma', 'koszty'],
  },
  {
    type: 'receipt',
    label: 'Paragon',
    patterns: [/\bparagon\s+fiskalny\b/i, /\bptu\s+[a-z]\b/i, /\bsuma\s+pln\b/i],
    hints: ['zakupy', 'paragony', 'rachunki', 'gwarancje'],
  },
  {
    type: 'contract',
    label: 'Umowa / Aneks',
    patterns: [/\bumowa\b/i, /\baneks\b/i, /§\s*\d+/],
    hints: ['umowy', 'praca', 'najem', 'notarialne'],
  },
  {
    type: 'tax_office',
    label: 'Urząd / Podatki',
    patterns: [/\b(zus|pit-\d+|urząd skarbowy|decyzja|wezwanie|zaświadczenie)\b/i],
    hints: ['urzędy', 'podatki', 'świadczenia'],
  },
  {
    type: 'insurance',
    label: 'Ubezpieczenie / Polisa',
    patterns: [/\b(polisa|ubezpieczeni|składka|pzu|warta|allianz|link4)\b/i],
    hints: ['ubezpieczenia', 'samochód', 'dom', 'zdrowie'],
  },
  {
    type: 'medical',
    label: 'Dokument medyczny',
    patterns: [/\b(wynik badania|recepta|skierowanie|szpital|przychodnia|diagnoza)\b/i],
    hints: ['zdrowie', 'dzieci', 'osobiste'],
  },
];

/** Classifies scanned text 100% offline on the mobile device and ranks matching local folders. */
export function classifyDocumentOnDevice(
  ocrText: string,
  folders: MobileFolderCandidate[],
  learnedBoosts?: Map<number, MobileLearnedBoost>,
): MobileClassificationResult {
  const normalized = (ocrText || '').toLocaleLowerCase('pl');
  let bestRule: (typeof RULES)[number] | null = null;
  let bestHits = 0;

  for (const rule of RULES) {
    const hits = rule.patterns.reduce((sum, re) => sum + (re.test(normalized) ? 1 : 0), 0);
    if (hits > bestHits) {
      bestHits = hits;
      bestRule = rule;
    }
  }

  const detectedLabel = bestRule?.label ?? 'Dokument ogólny';
  const suggestions: MobileFolderSuggestion[] = [];

  for (const folder of folders) {
    const nameNorm = folder.name.toLocaleLowerCase('pl');
    const words = nameNorm.split(/[\s,/._-]+/).filter(w => w.length >= 3);
    let score = 0;
    let reason = detectedLabel;

    for (const word of words) {
      if (normalized.includes(word)) {
        score += 3;
        reason = `słowo „${word}” w treści`;
      }
    }
    if (bestRule && bestRule.hints.some(hint => nameNorm.includes(hint))) {
      score += 5;
      reason = `dopasowanie: ${detectedLabel}`;
    }
    const learned = learnedBoosts?.get(folder.id);
    if (learned) {
      score += learned.boost;
      reason = learned.reason;
    }
    if (score > 0) {
      suggestions.push({ folderId: folder.id, folderName: folder.name, score, reason });
    }
  }

  suggestions.sort((a, b) => b.score - a.score || a.folderName.localeCompare(b.folderName, 'pl'));
  return {
    detectedType: bestRule?.type ?? 'other',
    detectedLabel,
    suggestions: suggestions.slice(0, 4),
  };
}
