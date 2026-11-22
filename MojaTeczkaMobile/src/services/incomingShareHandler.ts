import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getApiUrl, getAuthHeaders, getLocalConnection } from './localConnection';
import { ensureStandaloneFolders, saveStandaloneScan } from './standaloneFolders';
import { parseStructuredDocument } from './structuredDocumentParser';

export type IncomingSharePayload = {
  mimeType: string;
  uri?: string;
  fileName?: string;
  text?: string;
  subject?: string;
};

export type ParsedIncomingShare = {
  raw: IncomingSharePayload;
  suggestedTitle: string;
  detectedStore: string | null;
  detectedTotal: string | null;
  suggestWarranty: boolean;
  isStructuredReceipt: boolean;
};

const STORE_HINTS: Array<{ pattern: RegExp; label: string; warranty?: boolean }> = [
  { pattern: /biedronk|jeronimo/i, label: 'Biedronka' },
  { pattern: /lidl/i, label: 'Lidl' },
  { pattern: /zabka|żabka/i, label: 'Żabka' },
  { pattern: /kaufland/i, label: 'Kaufland' },
  { pattern: /media\s*expert/i, label: 'Media Expert', warranty: true },
  { pattern: /rtv\s*euro|euro\.com\.pl/i, label: 'RTV Euro AGD', warranty: true },
  { pattern: /x-kom/i, label: 'x-kom', warranty: true },
  { pattern: /castorama|leroy|obi/i, label: 'Sklep budowlany', warranty: true },
  { pattern: /orlen|bp\s|shell|circle\s*k/i, label: 'Stacja paliw' },
  { pattern: /eparagon|paragon\.mf\.gov\.pl/i, label: 'e-Paragon (HUB MF)' },
];

export async function readIncomingShare(): Promise<ParsedIncomingShare | null> {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules.ShareIntentModule as { getInitialShare?: () => Promise<IncomingSharePayload | null> } | undefined;
  if (!mod?.getInitialShare) return null;
  const raw = await mod.getInitialShare().catch(() => null);
  if (!raw || (!raw.uri && !raw.text)) return null;

  let textSample = [raw.subject, raw.text, raw.fileName].filter(Boolean).join('\n');
  let detectedStore: string | null = null;
  let detectedTotal: string | null = null;
  let suggestWarranty = false;
  let isStructuredReceipt = false;

  if (raw.uri && (raw.mimeType.includes('json') || raw.mimeType.includes('xml') || raw.mimeType.startsWith('text/'))) {
    const fileText = await FileSystem.readAsStringAsync(raw.uri).catch(() => '');
    if (fileText) textSample = `${textSample}\n${fileText}`;
  }

  const ext = (raw.fileName?.split('.').pop() || '').toLowerCase();
  const structured = parseStructuredDocument(textSample, ext, raw.mimeType);
  if (structured) {
    isStructuredReceipt = true;
    detectedStore = structured.sellerName;
    detectedTotal = structured.grossTotal ? `${structured.grossTotal} ${structured.currency}` : null;
  }

  for (const hint of STORE_HINTS) {
    if (hint.pattern.test(textSample)) {
      if (!detectedStore) detectedStore = hint.label;
      if (hint.warranty) suggestWarranty = true;
      break;
    }
  }

  if (!detectedTotal) {
    const amountMatch = /(?:suma|razem|do\s+zap[łl]aty|kwota)\s*:?\s*(\d+[.,]\d{2})\s*(?:z[łl]|pln)?/i.exec(textSample);
    if (amountMatch) detectedTotal = `${amountMatch[1].replace('.', ',')} PLN`;
  }

  const dateLabel = new Date().toLocaleDateString('pl-PL');
  const suggestedTitle = detectedStore
    ? `${isStructuredReceipt ? 'e-Paragon' : 'Dokument'} ${detectedStore} (${dateLabel})`
    : (raw.subject?.trim() || raw.fileName?.replace(/\.[^.]+$/, '') || `Udostępniony dokument (${dateLabel})`);

  return { raw, suggestedTitle, detectedStore, detectedTotal, suggestWarranty, isStructuredReceipt };
}

export async function clearIncomingShare(): Promise<void> {
  const mod = NativeModules.ShareIntentModule as { clearShare?: () => Promise<boolean> } | undefined;
  await mod?.clearShare?.().catch(() => undefined);
}

/** Saves an incoming Android Share Sheet document to the paired desktop or local standalone vault. */
export async function commitIncomingShare(parsed: ParsedIncomingShare, title: string, addWarranty: boolean): Promise<'desktop' | 'phone'> {
  const cleanTitle = title.trim() || parsed.suggestedTitle;
  const connection = await getLocalConnection().catch(() => null);

  let fileUri = parsed.raw.uri;
  let mimeType = parsed.raw.mimeType || 'application/octet-stream';
  let fileName = parsed.raw.fileName || `${cleanTitle.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48)}.json`;

  if (!fileUri && parsed.raw.text) {
    const isJson = parsed.raw.text.trim().startsWith('{');
    const isXml = parsed.raw.text.trim().startsWith('<');
    const ext = isJson ? 'json' : isXml ? 'xml' : 'txt';
    mimeType = isJson ? 'application/json' : isXml ? 'application/xml' : 'text/plain';
    fileName = `share_${Date.now()}.${ext}`;
    fileUri = `${FileSystem.cacheDirectory || ''}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, parsed.raw.text);
  }
  if (!fileUri) throw new Error('Brak pliku lub treści do zapisania.');

  if (connection) {
    const headers = await getAuthHeaders();
    const foldersRes = await fetch(await getApiUrl('/api/folders'), { headers });
    if (foldersRes.ok) {
      const folders = (await foldersRes.json()) as Array<{ id: number; name: string; parentId: number | null }>;
      const preferredName = addWarranty ? 'gwarancje' : 'paragony';
      const target = folders.find(f => f.name.toLowerCase().includes(preferredName))
        || folders.find(f => f.parentId !== null)
        || folders[0];
      if (target) {
        const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
        const uploadRes = await fetch(await getApiUrl('/api/documents/upload-base64'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderId: target.id,
            title: cleanTitle,
            fileName,
            mimeType,
            data: base64,
            retentionEnabled: addWarranty,
            retentionValue: addWarranty ? 2 : 5,
            retentionUnit: 'years',
          }),
        });
        if (uploadRes.ok) {
          await clearIncomingShare();
          return 'desktop';
        }
      }
    }
  }

  const standaloneFolders = await ensureStandaloneFolders();
  const targetFolder = standaloneFolders.find(f => f.name.toLowerCase().includes(addWarranty ? 'gwarancje' : 'paragony'))
    || standaloneFolders.find(f => f.parentId !== null)
    || standaloneFolders[0];

  await saveStandaloneScan({
    uploadId: `share_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    folderId: targetFolder.id,
    title: cleanTitle,
    pages: [fileUri],
    retentionEnabled: addWarranty,
    retentionValue: addWarranty ? '2' : '5',
    retentionUnit: 'years',
    grayscale: false,
  });
  await clearIncomingShare();
  return 'phone';
}
