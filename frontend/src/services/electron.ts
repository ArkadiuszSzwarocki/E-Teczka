export type AccessMode = 'pin' | 'password';

export type AccessStatus = { configured: boolean; mode: AccessMode | null; loginMethod?: 'password' | 'pin' | 'hello'; helloVerified?: boolean; helloLoginRegistered?: boolean; recoveryAvailable?: boolean; mailConfigured?: boolean };
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

let activeAccountPopup: Window | null = null;

export function closeExternalAccountPopup(): void {
  const ipc = getElectronIpc();
  if (ipc) {
    void ipc.invoke('eteczka-close-external-account').catch(() => undefined);
  }
  try {
    if (activeAccountPopup && !activeAccountPopup.closed) activeAccountPopup.close();
  } catch { /* ignore cross-window close errors */ }
  activeAccountPopup = null;
  try { window.focus(); } catch { /* ignore focus errors */ }
}

export async function openExternalAccountUrl(raw: string, origin: string): Promise<void> {
  const url = new URL(raw);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.origin !== origin || url.pathname !== '/account' || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)) throw new Error('Nieprawidłowy adres konta.');
  const ipc = getElectronIpc();
  if (ipc) {
    try { await ipc.invoke('eteczka-open-external-account', url.href); return; }
    catch { /* fall back to direct shell/window open */ }
  }
  const electron = (window as ElectronWindow).require?.('electron') as { shell?: { openExternal: (url: string, options?: { activate?: boolean }) => Promise<void> } } | undefined;
  if (electron?.shell) { await electron.shell.openExternal(url.href, { activate: true }); return; }
  const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || 1024) - 520) / 2));
  const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || 768) - 680) / 2));
  activeAccountPopup = window.open(url.href, 'eteczka_account_auth', `popup=yes,width=520,height=680,left=${left},top=${top}`);
}

type NodeFileSystem = {
  readFileSync: (path: string) => { toString: (encoding: string) => string };
  unlinkSync: (path: string) => void;
};

export function readScanFileBase64(path: string): string {
  const fileSystem = (window as ElectronWindow).require?.('fs') as NodeFileSystem | undefined;
  if (!fileSystem) throw new Error('System plików jest dostępny tylko w aplikacji desktopowej.');
  return fileSystem.readFileSync(path).toString('base64');
}

export function removeTemporaryScan(path: string): void {
  const fileSystem = (window as ElectronWindow).require?.('fs') as NodeFileSystem | undefined;
  try { fileSystem?.unlinkSync(path); } catch { /* temporary scan cleanup is best-effort */ }
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

export async function devReloadApp(): Promise<void> {
  const ipc = getElectronIpc();
  if (ipc) {
    try {
      const reloaded = await ipc.invoke('eteczka-dev-reload');
      if (reloaded) return;
    } catch { /* fall back to window reload */ }
  }
  window.location.reload();
}
