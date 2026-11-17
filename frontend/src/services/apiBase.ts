type AppLocation = Pick<Location, 'protocol' | 'hostname' | 'host' | 'port'>;

export function resolveApiBase(location: AppLocation, configuredUrl?: string): string {
  if (configuredUrl?.trim()) return configuredUrl.trim().replace(/\/+$/, '');
  if (location.protocol === 'file:') return 'http://127.0.0.1:3000';
  if (location.port === '5173') return `${location.protocol}//${location.hostname}:3000`;
  return `${location.protocol}//${location.host}`;
}
