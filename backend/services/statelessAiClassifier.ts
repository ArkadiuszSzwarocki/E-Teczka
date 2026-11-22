import {
  classifyDocumentOffline,
  type DocumentClassificationResult,
  type FolderCandidate,
} from './documentFolderClassifier';
import type { LearnedBoost } from './folderLearningStore';

export type SuggestionResponse = DocumentClassificationResult & {
  mode: 'ai-server' | 'offline';
};

/**
 * Classifies a scanned document using the self-hosted stateless AI server ONLY when
 * the user explicitly opted in and ETECZKA_AI_OCR_URL is configured; otherwise falls back to offline rules.
 */
export async function suggestFolderForDocument(
  ocrText: string,
  folders: FolderCandidate[],
  options: { allowServerAi: boolean; learnedBoosts?: Map<number, LearnedBoost> },
): Promise<SuggestionResponse> {
  const aiUrl = process.env.ETECZKA_AI_OCR_URL?.trim();
  if (!options.allowServerAi || !aiUrl) {
    return { mode: 'offline', ...classifyDocumentOffline(ocrText, folders, options.learnedBoosts) };
  }

  try {
    const endpoint = `${aiUrl.replace(/\/+$/, '')}/classify`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-No-Retain': 'true',
      },
      body: JSON.stringify({
        store: false,
        text: ocrText.slice(0, 20_000),
        folders: folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId })),
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return { mode: 'offline', ...classifyDocumentOffline(ocrText, folders, options.learnedBoosts) };
    }

    const payload = await response.json() as Partial<DocumentClassificationResult>;
    if (typeof payload?.detectedType === 'string' && Array.isArray(payload?.suggestions)) {
      const merged = payload.suggestions.map(s => {
        const learned = options.learnedBoosts?.get(s.folderId);
        return learned ? { ...s, score: s.score + learned.boost, reason: learned.reason } : s;
      });
      if (options.learnedBoosts) {
        const folderById = new Map(folders.map(f => [f.id, f]));
        for (const [folderId, learned] of options.learnedBoosts.entries()) {
          if (!merged.some(s => s.folderId === folderId) && folderById.has(folderId)) {
            merged.push({
              folderId,
              folderName: folderById.get(folderId)!.name,
              score: learned.boost,
              reason: learned.reason,
            });
          }
        }
      }
      merged.sort((a, b) => b.score - a.score);
      return {
        mode: 'ai-server',
        detectedType: payload.detectedType,
        detectedLabel: typeof payload.detectedLabel === 'string' ? payload.detectedLabel : payload.detectedType,
        suggestedTitle: typeof payload.suggestedTitle === 'string' ? payload.suggestedTitle : null,
        suggestions: merged.slice(0, 4),
      };
    }
  } catch {
    // Stateless AI server unreachable or timed out -> seamless offline fallback
  }

  return { mode: 'offline', ...classifyDocumentOffline(ocrText, folders, options.learnedBoosts) };
}
