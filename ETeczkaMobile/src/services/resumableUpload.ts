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

/** Marks a resumable upload as cancelled so any pending chunk loop stops immediately. */
export function cancelResumableUpload(uploadId?: string) {
  if (uploadId) cancelledUploads.add(uploadId);
}

/** Uploads chunks with resume support: queries already-received chunks on `/init` and skips them. */
export async function uploadChunksResumable(options: ResumableUploadOptions) {
  const doFetch = options.fetchFn || fetch;
  const totalChunks = options.chunksBase64.length;
  if (options.uploadId && cancelledUploads.has(options.uploadId)) {
    throw new Error('Przesyłanie pliku zostało anulowane po usunięciu dokumentu.');
  }

  const initRes = await doFetch(`${options.apiBaseUrl}/api/documents/upload-resumable/init`, {
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
  const received = new Set(initData.receivedChunks || []);
  options.onProgress?.(received.size, totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    if (cancelledUploads.has(initData.uploadId)) {
      throw new Error('Przesyłanie pliku zostało anulowane po usunięciu dokumentu.');
    }
    if (received.has(i)) continue;
    const chunkRes = await doFetch(`${options.apiBaseUrl}/api/documents/upload-resumable/${initData.uploadId}/chunk/${i}`, {
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

  const completeRes = await doFetch(`${options.apiBaseUrl}/api/documents/upload-resumable/${initData.uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || 'Nie udało się scalić przesłanego pliku.');
  }
  return completeRes.json() as Promise<{ success: boolean; uploadId?: string; document: unknown }>;
}
