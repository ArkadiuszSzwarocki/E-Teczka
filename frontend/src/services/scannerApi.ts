type Fetcher = typeof window.fetch;

export type PrinterPage = { dataUrl: string; bytes: number };
const MAX_PAGE_DATA_URL = 1_800_000;

/** Keep each scanned page readable while making a multi-page upload fit the API limit. */
export async function preparePrinterPage(base64: string): Promise<PrinterPage> {
  const image = new Image();
  image.src = `data:image/jpeg;base64,${base64}`;
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
