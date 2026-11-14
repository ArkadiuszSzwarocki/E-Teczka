type AppLocation = Pick<Location, 'protocol' | 'hostname'>;

export function resolveApiBase(location: AppLocation, configuredUrl?: string): string {
  if (configuredUrl?.trim()) return configuredUrl.trim().replace(/\/+$/, '');
  if (location.protocol === 'file:') return 'http://127.0.0.1:3000';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return 'http://localhost:3000';
  return `${location.protocol}//${location.hostname}:3000`;
}
