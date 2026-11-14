/** Validate a data URL without running a regular expression over its large payload. */
export function parseBase64DataUrl(value: unknown): { mimeType: string; base64: string } | null {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const separator = value.indexOf(';base64,');
  if (separator < 5 || separator > 133) return null;
  const mimeType = value.slice(5, separator);
  if (!/^[a-z][a-z0-9.+-]*\/[a-z0-9.+-]+$/i.test(mimeType)) return null;
  const start = separator + 8;
  const length = value.length - start;
  if (length === 0 || length % 4 !== 0) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let index = start; index < value.length - padding; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return null;
  }
  return { mimeType, base64: value.slice(start) };
}
