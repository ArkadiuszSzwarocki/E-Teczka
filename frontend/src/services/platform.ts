import { getElectronIpc } from './electron';

export type ClientPlatform = 'electron' | 'android' | 'ios' | 'web';

/** Returns true when running inside the Electron desktop shell. */
export function isElectronDesktop(): boolean {
  return Boolean(getElectronIpc());
}

/** Returns true when running in an Android mobile browser (non-Electron). */
export function isAndroidBrowser(): boolean {
  if (isElectronDesktop() || typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent || '');
}

/** Returns true when running on a mobile/touch browser (Android, iOS, or coarse-pointer handheld). */
export function isMobileBrowser(): boolean {
  if (isElectronDesktop() || typeof navigator === 'undefined') return false;
  if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '')) return true;
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches) && window.innerWidth < 1024;
}

/** Resolves the active client platform identifier. */
export function getClientPlatform(): ClientPlatform {
  if (isElectronDesktop()) return 'electron';
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  }
  return 'web';
}

/** Formats the environment badge shown in the navigation sidebar. */
export function getEnvironmentLabel(isDev: boolean): string {
  const platform = getClientPlatform();
  if (platform === 'electron') return isDev ? 'DESKTOP DEV' : 'DESKTOP';
  if (platform === 'android') return isDev ? 'ANDROID DEV' : 'ANDROID';
  if (platform === 'ios') return isDev ? 'IOS DEV' : 'IOS';
  if (isMobileBrowser()) return isDev ? 'MOBILE DEV' : 'MOBILE';
  return isDev ? 'WEB DEV' : 'WEB';
}
