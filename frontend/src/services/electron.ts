export type AccessMode = 'pin' | 'password';

export type AccessStatus = { configured: boolean; mode: AccessMode | null };
export type AccessResult = { ok: boolean; error?: string };
export type WiaDevice = { id: string; name: string; manufacturer?: string };
export type WiaScanResult = { ok: boolean; path?: string };

type IpcRenderer = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  removeListener: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
};

type ElectronWindow = Window & {
  require?: (moduleName: string) => unknown;
};

export function getElectronIpc(): IpcRenderer | null {
  const electron = (window as ElectronWindow).require?.('electron') as { ipcRenderer?: IpcRenderer } | undefined;
  return electron?.ipcRenderer ?? null;
}

type NodeFileSystem = {
  readFileSync: (path: string) => { toString: (encoding: string) => string };
  unlinkSync: (path: string) => void;
};

export function readAndRemoveFileBase64(path: string): string {
  const fileSystem = (window as ElectronWindow).require?.('fs') as NodeFileSystem | undefined;
  if (!fileSystem) throw new Error('System plików jest dostępny tylko w aplikacji desktopowej.');
  try {
    return fileSystem.readFileSync(path).toString('base64');
  } finally {
    try { fileSystem.unlinkSync(path); } catch { /* temporary scan cleanup is best-effort */ }
  }
}

export function isAccessStatus(value: unknown): value is AccessStatus {
  if (!value || typeof value !== 'object') return false;
  const status = value as Partial<AccessStatus>;
  return typeof status.configured === 'boolean' && (status.mode === null || status.mode === 'pin' || status.mode === 'password');
}

export function isAccessResult(value: unknown): value is AccessResult {
  return Boolean(value) && typeof value === 'object' && typeof (value as { ok?: unknown }).ok === 'boolean';
}

export function isWiaDeviceList(value: unknown): value is WiaDevice[] {
  return Array.isArray(value) && value.every((device) => Boolean(device) && typeof device === 'object' && typeof (device as WiaDevice).id === 'string' && typeof (device as WiaDevice).name === 'string');
}

export function isWiaScanResult(value: unknown): value is WiaScanResult {
  return Boolean(value) && typeof value === 'object' && typeof (value as WiaScanResult).ok === 'boolean';
}
