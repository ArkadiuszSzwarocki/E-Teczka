import type { DocumentPatch } from '../types/domain';
type Fetcher = typeof window.fetch;
export async function patchDocument(apiUrl: string, fetcher: Fetcher, id: number, data: DocumentPatch) { return fetcher(`${apiUrl}/api/documents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
export async function deleteDocument(apiUrl: string, fetcher: Fetcher, id: number) { return fetcher(`${apiUrl}/api/documents/${id}`, { method: 'DELETE' }); }
export async function exportDocuments(apiUrl: string, fetcher: Fetcher, ids: number[]) {
  const response = await fetcher(`${apiUrl}/api/documents/export-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentIds: ids }) });
  if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || 'Nie udało się wyeksportować dokumentów.'); }
  return response.blob();
}
