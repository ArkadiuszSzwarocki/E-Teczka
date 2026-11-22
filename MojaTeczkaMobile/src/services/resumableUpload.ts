export type ResumableUploadOptions = {
  apiBaseUrl: string;
  headers: Record<string, string>;
  folderId: number;
  fileName: string;
  mimeType: string;
  chunksBase64: string[];
  uploadId?: string;
  fetchFn?: typeof fetch;
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
};

/**
 * Splits a base64 payload into fixed-size base64 slices aligned on 4-char boundaries
 * (so each slice decodes cleanly to bytes on the server).
 */
export function sliceBase64ForResumable(base64: string, chunkChars = 262_144): string[] {
  const aligned = Math.max(4, Math.floor(chunkChars / 4) * 4);
  const parts: string[] = [];
  for (let i = 0; i < base64.length; i += aligned) {
    parts.push(base64.slice(i, i + aligned));
  }
  return parts.length ? parts : [''];
}

const cancelledUploads = new Set<string>();
const MAX_CANCELLED_TRACKED = 200;
const CHUNK_TIMEOUT_MS = 20_000;

/** Marks a resumable upload as cancelled so any pending chunk loop stops immediately. */
export function cancelResumableUpload(uploadId?: string) {
  if (!uploadId) return;
  if (cancelledUploads.size >= MAX_CANCELLED_TRACKED) {
    const oldest = cancelledUploads.values().next().value;
    if (oldest) cancelledUploads.delete(oldest);
  }
  cancelledUploads.add(uploadId);
}

async function fetchChunkWithTimeout(doFetch: typeof fetch, url: string, init: RequestInit, timeoutMs = CHUNK_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Przekroczono limit czasu połączenia podczas wysyłania pliku. Sprawdź Wi-Fi i spróbuj ponownie.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Uploads chunks with resume support: queries already-received chunks on `/init` and skips them. */
export async function uploadChunksResumable(options: ResumableUploadOptions) {
  const doFetch = options.fetchFn || fetch;
  const totalChunks = options.chunksBase64.length;
  if (options.uploadId && cancelledUploads.has(options.uploadId)) {
    cancelledUploads.delete(options.uploadId);
    throw new Error('Przesyłanie pliku zostało anulowane po usunięciu dokumentu.');
  }

  let activeUploadId = options.uploadId;
  try {
    const initRes = await fetchChunkWithTimeout(doFetch, `${options.apiBaseUrl}/api/documents/upload-resumable/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify({
        uploadId: options.uploadId,
        folderId: options.folderId,
        fileName: options.fileName,
        mimeType: options.mimeType,
        totalChunks,
      }),
    });
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || 'Nie udało się zainicjować wznawianego uploadu.');
    }
    const initData = await initRes.json() as { uploadId: string; receivedChunks: number[] };
    activeUploadId = initData.uploadId;
    const received = new Set(initData.receivedChunks || []);
    options.onProgress?.(received.size, totalChunks);

    for (let i = 0; i < totalChunks; i++) {
      if (cancelledUploads.has(initData.uploadId)) {
        throw new Error('Przesyłanie pliku zostało anulowane po usunięciu dokumentu.');
      }
      if (received.has(i)) continue;
      const chunkRes = await fetchChunkWithTimeout(doFetch, `${options.apiBaseUrl}/api/documents/upload-resumable/${initData.uploadId}/chunk/${i}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify({ data: options.chunksBase64[i] }),
      });
      if (!chunkRes.ok) {
        const err = await chunkRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Zerwano przesyłanie na części ${i + 1}/${totalChunks}.`);
      }
      received.add(i);
      options.onProgress?.(received.size, totalChunks);
    }

    const completeRes = await fetchChunkWithTimeout(doFetch, `${options.apiBaseUrl}/api/documents/upload-resumable/${initData.uploadId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!completeRes.ok) {
      const err = await completeRes.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error || 'Nie udało się scalić przesłanego pliku.');
    }
    return completeRes.json() as Promise<{ success: boolean; uploadId?: string; document: unknown }>;
  } finally {
    if (activeUploadId) cancelledUploads.delete(activeUploadId);
    if (options.uploadId && options.uploadId !== activeUploadId) cancelledUploads.delete(options.uploadId);
  }
}
