import * as ImageManipulator from 'expo-image-manipulator';
import { getApiUrl, getAuthHeaders } from './localConnection';
import { uploadSecureScanPage } from './secureFileTransfer';
import type { RetentionUnit } from '../types/domain';

type Input = {
  uploadId: string;
  pages: string[];
  folderId: number;
  title: string;
  retentionEnabled: boolean;
  retentionValue: string;
  retentionUnit: RetentionUnit;
  onStage: (label: string) => void;
};

const withTimeout = <T,>(operation: Promise<T>, ms: number, message: string) => Promise.race<T>([
  operation,
  new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
]);

/** Transfers each page reliably, then asks the desktop to merge them to one PDF. */
export async function uploadScanDocument(input: Input) {
  const apiUrl = (await getApiUrl('/')).replace(/\/$/, '');
  const headers = await getAuthHeaders();
  const draftId = input.uploadId;
  for (let index = 0; index < input.pages.length; index += 1) {
    input.onStage(`Wysyłanie strony ${index + 1} z ${input.pages.length}…`);
    const upload = await uploadSecureScanPage(`${apiUrl}/api/mobile-scan-draft/page`, input.pages[index], headers, draftId, index + 1);
    if (upload.status < 200 || upload.status >= 300) throw new Error(`Komputer odrzucił stronę ${index + 1} (kod ${upload.status}).`);
  }
  input.onStage('Scalanie stron do PDF na komputerze…');
  const thumbnail = await ImageManipulator.manipulateAsync(input.pages[0], [{ resize: { width: 180 } }], { compress: 0.35, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  const response = await withTimeout(fetch(`${apiUrl}/api/mobile-scan-draft/finalize`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageKeys: input.pages.map(page => page.split('/').pop() || page), printerJobs: input.pages.flatMap(page => { const match = /printer_draft_([0-9a-f-]{36})\.jpg$/i.exec(page); return match ? [match[1]] : []; }), draftId, folderId: input.folderId, title: input.title, retentionEnabled: input.retentionEnabled, retentionValue: input.retentionValue, retentionUnit: input.retentionUnit, thumbnail: thumbnail.base64 ? `data:image/jpeg;base64,${thumbnail.base64}` : undefined }),
  }), 45_000, 'Scalanie trwa zbyt długo. Dokument może być już zapisany — sprawdź kartotekę na komputerze.');
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || `Serwer odpowiedział kodem ${response.status}`); }
}
