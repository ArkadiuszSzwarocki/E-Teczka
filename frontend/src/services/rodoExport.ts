import type { RodoRegion } from './rodoRegions';

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Burns pixelated RODO mosaic into an image in-browser and downloads a PNG copy. */
export async function downloadRedactedImage(
  imageUrl: string,
  title: string,
  regions: RodoRegion[],
): Promise<void> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Nie udało się wczytać obrazu do eksportu RODO.'));
    el.src = imageUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Brak kontekstu graficznego.');
  ctx.drawImage(img, 0, 0);

  for (const r of regions) {
    const x = Math.max(0, Math.floor((r.x / 100) * canvas.width));
    const y = Math.max(0, Math.floor((r.y / 100) * canvas.height));
    const w = Math.max(4, Math.min(canvas.width - x, Math.ceil((r.w / 100) * canvas.width)));
    const h = Math.max(4, Math.min(canvas.height - y, Math.ceil((r.h / 100) * canvas.height)));
    const pixelSize = Math.max(8, Math.round(Math.min(w, h) / 4));
    const cols = Math.max(1, Math.floor(w / pixelSize));
    const rows = Math.max(1, Math.floor(h / pixelSize));
    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    const sctx = small.getContext('2d');
    if (sctx) {
      sctx.drawImage(canvas, x, y, w, h, 0, 0, cols, rows);
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
      ctx.imageSmoothingEnabled = prev;
    }
  }

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Nie udało się zapisać obrazu RODO.');
  const baseName = title.replace(/\.[^.]+$/, '');
  triggerBlobDownload(blob, `${baseName}-RODO.png`);
}

/** Downloads a PDF with RODO mosaic permanently burned into the affected pages via backend. */
export async function downloadRedactedPdf(
  apiUrl: string,
  fetcher: typeof fetch,
  docId: number,
  title: string,
  regions: RodoRegion[],
): Promise<void> {
  const res = await fetcher(`${apiUrl}/api/documents/${docId}/export-rodo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regions }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || 'Nie udało się pobrać PDF z RODO.');
  }
  const blob = await res.blob();
  const baseName = title.replace(/\.pdf$/i, '');
  triggerBlobDownload(blob, `${baseName}-RODO.pdf`);
}
