import type { WiaDevice } from './electron';

type Fetcher = typeof window.fetch;

export type PrinterPage = { dataUrl: string; bytes: number };
const MAX_PAGE_DATA_URL = 1_800_000;

export async function fetchWiaDevices(apiUrl: string, fetcher: Fetcher): Promise<WiaDevice[]> {
  const response = await fetcher(`${apiUrl}/api/printer-scan/devices`);
  const payload = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error((payload as { error?: string }).error || 'Nie udało się odczytać listy skanerów.');
  return Array.isArray(payload) ? payload as WiaDevice[] : [];
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) return reject(new Error('Nie udało się odczytać obrazu ze skanera.'));
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Nie udało się odczytać obrazu ze skanera.'));
    reader.readAsDataURL(blob);
  });
}

export async function scanViaBackend(
  apiUrl: string,
  fetcher: Fetcher,
  deviceId: string,
  folderId: string,
  onStage: (stage: string) => void,
): Promise<string> {
  const start = await fetcher(`${apiUrl}/api/printer-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, ...(folderId ? { folderId: Number(folderId) } : {}) }),
  });
  const started = await start.json().catch(() => ({})) as { jobId?: string; error?: string };
  if (!start.ok || !started.jobId) throw new Error(started.error || 'Nie udało się uruchomić skanowania.');

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 600));
    const statusRes = await fetcher(`${apiUrl}/api/printer-scan/${encodeURIComponent(started.jobId)}`);
    const job = await statusRes.json().catch(() => ({})) as { status?: string; stage?: string; error?: string };
    if (!statusRes.ok) throw new Error(job.error || 'Nie udało się sprawdzić statusu skanowania.');
    if (job.stage) onStage(job.stage);
    if (job.status === 'failed') throw new Error(job.error || 'Nie udało się zeskanować dokumentu.');
    if (job.status === 'completed') {
      const fileRes = await fetcher(`${apiUrl}/api/printer-scan/${encodeURIComponent(started.jobId)}/file`);
      if (!fileRes.ok) throw new Error('Nie udało się pobrać zeskanowanej strony.');
      return blobToBase64(await fileRes.blob());
    }
  }
  throw new Error('Przekroczono czas oczekiwania na skaner.');
}

/** Keep each scanned page readable while making a multi-page upload fit the API limit. */
export async function preparePrinterPage(base64OrDataUrl: string): Promise<PrinterPage> {
  const image = new Image();
  image.src = base64OrDataUrl.startsWith('data:') ? base64OrDataUrl : `data:image/jpeg;base64,${base64OrDataUrl}`;
  await image.decode();
  let maxSide = 2400;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Nie udało się przygotować obrazu skanu.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', Math.max(0.55, 0.8 - attempt * 0.06));
    if (dataUrl.length <= MAX_PAGE_DATA_URL) return { dataUrl, bytes: Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4) };
    maxSide = Math.round(maxSide * 0.82);
  }
  throw new Error('Ta strona nadal jest za duża po kompresji. Zmień ustawienia skanera na 300 DPI lub mniej.');
}

export async function uploadPrinterDocument(apiUrl: string, fetcher: Fetcher, pages: PrinterPage[], title: string, retention: { enabled: boolean; value: number; unit: string }) {
  if (!pages.length || pages.length > 20) throw new Error('Wybierz od 1 do 20 stron.');
  if (!title.trim()) throw new Error('Podaj nazwę dokumentu.');
  const files = pages.map((page, index) => ({ name: `Strona ${index + 1}.jpg`, data: page.dataUrl }));
  const response = await fetcher(`${apiUrl}/api/scanner`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, title, retention }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; details?: string };
    throw new Error(payload.details || payload.error || (response.status === 413 ? 'Dokument jest za duży do przesłania.' : `Nie udało się zapisać skanu (HTTP ${response.status}).`));
  }
  const saved = await response.json() as { id?: string; title?: string; createdAt?: string; pdfa?: boolean; pdfaWarning?: string };
  if (!saved.id) throw new Error('Serwer nie potwierdził zapisu dokumentu.');
  return saved;
}
