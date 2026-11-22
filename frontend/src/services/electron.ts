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
  mojateczkaElectron?: {
    ipcRenderer?: IpcRenderer;
    getZoomFactor?: () => number;
    openExternal?: (url: string) => Promise<boolean>;
  };
  require?: (moduleName: string) => unknown;
};

export function getElectronIpc(): IpcRenderer | null {
  const win = window as ElectronWindow;
  if (win.mojateczkaElectron?.ipcRenderer) return win.mojateczkaElectron.ipcRenderer;
  const electron = win.require?.('electron') as { ipcRenderer?: IpcRenderer } | undefined;
  return electron?.ipcRenderer ?? null;
}

let activeAccountPopup: Window | null = null;

export function closeExternalAccountPopup(): void {
  const ipc = getElectronIpc();
  if (ipc) {
    void ipc.invoke('mojateczka-close-external-account').catch(() => undefined);
  }
  try {
    if (activeAccountPopup && !activeAccountPopup.closed) activeAccountPopup.close();
  } catch { /* ignore cross-window close errors */ }
  activeAccountPopup = null;
  try { window.focus(); } catch { /* ignore focus errors */ }
}

export type AccountEmbedBounds = { x: number; y: number; width: number; height: number };

export function getScaledElementBounds(element: HTMLElement | null): AccountEmbedBounds | undefined {
  if (!element) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width < 100 || rect.height < 100) return undefined;
  const win = window as ElectronWindow;
  const electron = win.require?.('electron') as { webFrame?: { getZoomFactor: () => number } } | undefined;
  const zoom = win.mojateczkaElectron?.getZoomFactor?.() || electron?.webFrame?.getZoomFactor?.() || 1;
  return {
    x: Math.round(rect.left * zoom),
    y: Math.round(rect.top * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

export async function updateExternalAccountBounds(bounds: AccountEmbedBounds): Promise<void> {
  const ipc = getElectronIpc();
  if (ipc) {
    await ipc.invoke('mojateczka-resize-external-account', bounds).catch(() => undefined);
  }
}

export async function openExternalAccountUrl(raw: string, origin: string, bounds?: AccountEmbedBounds): Promise<void> {
  const url = new URL(raw);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.origin !== origin || url.pathname !== '/account' || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)) throw new Error('Nieprawidłowy adres konta.');
  const ipc = getElectronIpc();
  if (ipc) {
    try { await ipc.invoke('mojateczka-open-external-account', url.href, bounds); return; }
    catch { /* fall back to direct shell/window open */ }
  }
  const win = window as ElectronWindow;
  if (win.mojateczkaElectron?.openExternal) {
    await win.mojateczkaElectron.openExternal(url.href);
    return;
  }
  const electron = win.require?.('electron') as { shell?: { openExternal: (url: string, options?: { activate?: boolean }) => Promise<void> } } | undefined;
  if (electron?.shell) { await electron.shell.openExternal(url.href, { activate: true }); return; }
  const left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || 1024) - 520) / 2));
  const top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || 768) - 680) / 2));
  activeAccountPopup = window.open(url.href, 'mojateczka_account_auth', `popup=yes,width=520,height=680,left=${left},top=${top}`);
}

type NodeFileSystem = {
  readFileSync: (path: string) => { toString: (encoding: string) => string };
  unlinkSync: (path: string) => void;
};

export async function readScanFileBase64(path: string): Promise<string> {
  const ipc = getElectronIpc();
  if (ipc) {
    return await ipc.invoke('mojateczka-read-temp-scan', path) as string;
  }
  const fileSystem = (window as ElectronWindow).require?.('fs') as NodeFileSystem | undefined;
  if (!fileSystem) throw new Error('System plików jest dostępny tylko w aplikacji desktopowej.');
  return fileSystem.readFileSync(path).toString('base64');
}

export function removeTemporaryScan(path: string): void {
  const ipc = getElectronIpc();
  if (ipc) {
    void ipc.invoke('mojateczka-remove-temp-scan', path).catch(() => undefined);
    return;
  }
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
      const reloaded = await ipc.invoke('mojateczka-dev-reload');
      if (reloaded) return;
    } catch { /* fall back to window reload */ }
  }
  window.location.reload();
}
