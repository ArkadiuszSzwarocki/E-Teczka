import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { getApiUrl, getAuthHeaders } from './localConnection';
import type { RetentionUnit } from '../types/domain';

type Input = {
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
  const draftId = 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 14);
  for (let index = 0; index < input.pages.length; index += 1) {
    input.onStage(`Wysyłanie strony ${index + 1} z ${input.pages.length}…`);
    const upload = await withTimeout(FileSystem.uploadAsync(`${apiUrl}/api/mobile-scan-draft/page`, input.pages[index], {
      fieldName: 'file', httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      headers, parameters: { draftId, pageNumber: String(index + 1) },
    }), 45_000, `Nie udało się wysłać strony ${index + 1}. Sprawdź połączenie z komputerem.`);
    if (upload.status < 200 || upload.status >= 300) throw new Error(`Komputer odrzucił stronę ${index + 1} (kod ${upload.status}).`);
  }
  input.onStage('Scalanie stron do PDF na komputerze…');
  const thumbnail = await ImageManipulator.manipulateAsync(input.pages[0], [{ resize: { width: 180 } }], { compress: 0.35, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  const response = await withTimeout(fetch(`${apiUrl}/api/mobile-scan-draft/finalize`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId, folderId: input.folderId, title: input.title, retentionEnabled: input.retentionEnabled, retentionValue: input.retentionValue, retentionUnit: input.retentionUnit, thumbnail: thumbnail.base64 ? `data:image/jpeg;base64,${thumbnail.base64}` : undefined }),
  }), 45_000, 'Scalanie trwa zbyt długo. Dokument może być już zapisany — sprawdź kartotekę na komputerze.');
  if (!response.ok) throw new Error(`Serwer odpowiedział kodem ${response.status}`);
}
