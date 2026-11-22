const APP_ZOOM_STORAGE_KEY = 'mojateczka_app_zoom';
export const APP_ZOOM_PRESETS = [80, 90, 100, 110, 125] as const;

export function clampAppZoom(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(150, Math.max(70, Math.round(value)));
}

export function getAppZoom(): number {
  const raw = Number(localStorage.getItem(APP_ZOOM_STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampAppZoom(raw) : 100;
}

export function applyAppZoom(percent: number): number {
  const safe = clampAppZoom(percent);
  const win = window as {
    mojateczkaElectron?: { setZoomFactor?: (factor: number) => void };
    require?: (id: string) => unknown;
  };
  const electron = win.require?.('electron') as { webFrame?: { setZoomFactor: (factor: number) => void } } | undefined;
  const setNativeZoom = win.mojateczkaElectron?.setZoomFactor || electron?.webFrame?.setZoomFactor;
  if (setNativeZoom) {
    document.documentElement.style.zoom = '';
    setNativeZoom(safe / 100);
  } else {
    document.documentElement.style.zoom = `${safe / 100}`;
  }
  return safe;
}

export function setAppZoom(percent: number): number {
  const safe = applyAppZoom(percent);
  localStorage.setItem(APP_ZOOM_STORAGE_KEY, String(safe));
  return safe;
}

export function initAppZoom(): number {
  return applyAppZoom(getAppZoom());
}
