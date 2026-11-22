import type { RetentionUnit } from '../types/domain';
import { isLocalTesterFetcher } from './localTesterStore';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

export type UploadItem = { file: File; enabled: boolean; value: number; unit: RetentionUnit };
export type PreparedUpload = { name: string; data: string; thumbnail: string | null };
export type UploadProgress = {
  phase: 'preparing' | 'uploading' | 'processing';
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  loadedBytes: number;
  totalBytes: number;
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

type ThumbnailGenerator = (file: File) => Promise<string | null>;

export async function generatePdfThumbnail(file: File): Promise<string | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1, 180 / original.width) });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const thumbnail = canvas.toDataURL('image/jpeg', 0.78);
    await pdf.cleanup();
    return thumbnail;
  } catch { return null; }
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`Nie udało się odczytać pliku ${file.name}.`));
    reader.onerror = () => reject(new Error(`Nie udało się odczytać pliku ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file: File): Promise<PreparedUpload> {
  const source = await readAsDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Nie udało się odczytać obrazu ${file.name}.`));
    element.src = source;
  });
  let width = image.width; let height = image.height; const maxSize = 1600;
  if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; }
  else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error(`Nie udało się przetworzyć obrazu ${file.name}.`);
  context.drawImage(image, 0, 0, width, height);
  return { name: `${file.name.replace(/\.[^/.]+$/, '')}.jpg`, data: canvas.toDataURL('image/jpeg', 0.8), thumbnail: canvas.toDataURL('image/jpeg', 0.1) };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Przerwano wysyłanie.', 'AbortError');
}

export async function prepareUploadFiles(
  items: UploadItem[],
  generatePdfThumbnail: ThumbnailGenerator,
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<PreparedUpload[]> {
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0);
  let doneBytes = 0;
  const results: PreparedUpload[] = [];
  for (let i = 0; i < items.length; i++) {
    throwIfAborted(signal);
    const { file } = items[i];
    onProgress?.({ phase: 'preparing', fileName: file.name, fileIndex: i + 1, totalFiles: items.length, loadedBytes: doneBytes, totalBytes });
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    results.push(isPdf ? { name: file.name, data: await readAsDataUrl(file), thumbnail: await generatePdfThumbnail(file) } : await prepareImage(file));
    throwIfAborted(signal);
    doneBytes += file.size;
    onProgress?.({ phase: 'preparing', fileName: file.name, fileIndex: i + 1, totalFiles: items.length, loadedBytes: doneBytes, totalBytes });
  }
  return results;
}

type UploadResponsePayload = { error?: string; details?: string; savedDocs?: unknown[]; skippedDuplicates?: Array<{ name: string; existingTitle: string }> };

function sendWithProgress(url: string, body: string, label: string, totalFiles: number, onProgress: (progress: UploadProgress) => void, signal?: AbortSignal): Promise<UploadResponsePayload> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Przerwano wysyłanie.', 'AbortError'));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('eteczka_auth_token') : null;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    const payloadBytes = new Blob([body]).size;
    xhr.upload.onprogress = event => {
      const total = event.lengthComputable && event.total > 0 ? event.total : payloadBytes;
      const loaded = Math.min(event.loaded, total);
      onProgress({ phase: loaded >= total ? 'processing' : 'uploading', fileName: label, fileIndex: totalFiles, totalFiles, loadedBytes: loaded, totalBytes: total });
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      let data: UploadResponsePayload = {};
      try { data = JSON.parse(xhr.responseText || '{}') as UploadResponsePayload; } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new Error(data.error || data.details || `Serwer odrzucił wgrywanie (HTTP ${xhr.status}).`));
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Przerwano wysyłanie.', 'AbortError'));
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Utracono połączenie podczas wgrywania. Sprawdź kartotekę przed ponowieniem, aby nie dodać duplikatów.'));
    };
    xhr.send(body);
  });
}

export async function uploadDocuments(
  apiUrl: string,
  fetcher: typeof window.fetch,
  files: PreparedUpload[],
  items: UploadItem[],
  folderId: number,
  options: { physicalLocation: string | null; isMerge: boolean; mergedTitle: string; mergedRetention: { enabled: boolean; value: number; unit: RetentionUnit } },
  onProgress?: (progress: UploadProgress) => void,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const body = JSON.stringify({ files, folderId, physicalLocation: options.physicalLocation, retentions: items.map(item => ({ enabled: item.enabled, value: item.value, unit: item.unit })), isMerge: options.isMerge, mergedTitle: options.mergedTitle, mergedRetention: options.mergedRetention });
  const bodyBytes = new Blob([body]).size;
  if (bodyBytes > 50 * 1024 * 1024) throw new Error('Wybrane pliki są za duże na jedno wgranie (limit 50 MB po zakodowaniu). Wybierz mniejszą grupę plików.');
  const label = options.isMerge ? `${options.mergedTitle} (${files.length} str.)` : files.length === 1 ? files[0].name : `${files[0].name} (+${files.length - 1} innych)`;
  if (onProgress && typeof XMLHttpRequest !== 'undefined' && !isLocalTesterFetcher(fetcher)) {
    return sendWithProgress(`${apiUrl}/api/documents/upload-base64`, body, label, files.length, onProgress, signal);
  }
  onProgress?.({ phase: 'processing', fileName: label, fileIndex: files.length, totalFiles: files.length, loadedBytes: bodyBytes, totalBytes: bodyBytes });
  let response: Response;
  try { response = await fetcher(`${apiUrl}/api/documents/upload-base64`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal }); }
  catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new Error('Utracono połączenie podczas wgrywania. Sprawdź kartotekę przed ponowieniem, aby nie dodać duplikatów.');
  }
  const payload = await response.json().catch(() => ({})) as UploadResponsePayload;
  if (!response.ok) throw new Error(payload.error || payload.details || `Serwer odrzucił wgrywanie (HTTP ${response.status}).`);
  return payload;
}
