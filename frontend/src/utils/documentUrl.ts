/** Builds an authenticated `/uploads/<file>` URL from a stored `DocumentRecord.filePath`. */
export function buildDocumentFileUrl(apiUrl: string, filePath?: string | null): string {
  const base = apiUrl.replace(/\/+$/, '');
  const clean = (filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const prefixed = clean.startsWith('uploads/') ? clean : `uploads/${clean}`;
  return `${base}/${prefixed}`;
}
