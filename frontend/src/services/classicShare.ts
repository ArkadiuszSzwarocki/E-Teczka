import type { DocumentRecord } from '../types/domain';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function buildFileName(title: string, filePath: string, mimeType: string): string {
  const cleanTitle = (title || 'dokument').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'dokument';
  const extMatch = /\.([a-z0-9]{2,5})$/i.exec(filePath || '');
  const ext = extMatch?.[1]?.toLowerCase() || (mimeType.includes('pdf') ? 'pdf' : mimeType.includes('png') ? 'png' : 'jpg');
  return cleanTitle.toLowerCase().endsWith(`.${ext}`) ? cleanTitle : `${cleanTitle}.${ext}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function shareDocumentClassic(
  apiUrl: string,
  fetcher: Fetcher,
  doc: Pick<DocumentRecord, 'title' | 'filePath' | 'mimeType'>,
): Promise<'shared' | 'downloaded'> {
  const source = `${apiUrl}/${doc.filePath.replace(/\\/g, '/')}`;
  const response = await fetcher(source);
  if (!response.ok) throw new Error('Nie udało się pobrać pliku dokumentu.');
  const blob = await response.blob();
  const mime = doc.mimeType || blob.type || 'application/pdf';
  const filename = buildFileName(doc.title, doc.filePath, mime);
  const file = new File([blob], filename, { type: mime });
  if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    await navigator.share({ title: doc.title, files: [file] });
    return 'shared';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export async function shareLinkClassic(title: string, url: string): Promise<'shared' | 'mailto'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text: `Dokument E‑Teczki: ${title}`, url });
      return 'shared';
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') throw error;
    }
  }
  window.location.href = `mailto:?subject=${encodeURIComponent(`Dokument E‑Teczki: ${title}`)}&body=${encodeURIComponent(url)}`;
  return 'mailto';
}
