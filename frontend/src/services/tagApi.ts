type Fetcher = typeof window.fetch;
export async function createTag(apiUrl: string, fetcher: Fetcher, name: string, color: string) { return fetcher(`${apiUrl}/api/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }) }); }
export async function deleteTag(apiUrl: string, fetcher: Fetcher, id: number) { return fetcher(`${apiUrl}/api/tags/${id}`, { method: 'DELETE' }); }
