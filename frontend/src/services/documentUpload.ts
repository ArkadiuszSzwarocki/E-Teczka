import type { RetentionUnit } from '../types/domain';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';

export type UploadItem = { file: File; enabled: boolean; value: number; unit: RetentionUnit };
export type PreparedUpload = { name: string; data: string; thumbnail: string | null };

type ThumbnailGenerator = (file: File) => Promise<string | null>;

export async function generatePdfThumbnail(file: File): Promise<string | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1, 180 / original.width) });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    const thumbnail = canvas.toDataURL('image/jpeg', 0.78);
    await pdf.destroy();
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

export async function prepareUploadFiles(items: UploadItem[], generatePdfThumbnail: ThumbnailGenerator): Promise<PreparedUpload[]> {
  return Promise.all(items.map(async ({ file }) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) return prepareImage(file);
    return { name: file.name, data: await readAsDataUrl(file), thumbnail: await generatePdfThumbnail(file) };
  }));
}

export async function uploadDocuments(apiUrl: string, fetcher: typeof window.fetch, files: PreparedUpload[], items: UploadItem[], folderId: number, options: { physicalLocation: string | null; isMerge: boolean; mergedTitle: string; mergedRetention: { enabled: boolean; value: number; unit: RetentionUnit } }) {
  const body = JSON.stringify({ files, folderId, physicalLocation: options.physicalLocation, retentions: items.map(item => ({ enabled: item.enabled, value: item.value, unit: item.unit })), isMerge: options.isMerge, mergedTitle: options.mergedTitle, mergedRetention: options.mergedRetention });
  if (new Blob([body]).size > 50 * 1024 * 1024) throw new Error('Wybrane pliki są za duże na jedno wgranie (limit 50 MB po zakodowaniu). Wybierz mniejszą grupę plików.');
  let response: Response;
  try { response = await fetcher(`${apiUrl}/api/documents/upload-base64`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
  catch { throw new Error('Utracono połączenie podczas wgrywania. Sprawdź kartotekę przed ponowieniem, aby nie dodać duplikatów.'); }
  const payload = await response.json().catch(() => ({})) as { error?: string; details?: string; savedDocs?: unknown[]; skippedDuplicates?: Array<{ name: string; existingTitle: string }> };
  if (!response.ok) throw new Error(payload.error || payload.details || `Serwer odrzucił wgrywanie (HTTP ${response.status}).`);
  return payload;
}
