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

/** Returns true when running on iOS/iPadOS (including iPad desktop-class UA with touch points). */
export function isIosBrowser(): boolean {
  if (isElectronDesktop() || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Returns true when running in a macOS desktop browser (non-Electron, non-iPad). */
export function isMacOsBrowser(): boolean {
  if (isElectronDesktop() || typeof navigator === 'undefined') return false;
  if (isIosBrowser()) return false;
  return /macintosh|mac os x/i.test(navigator.userAgent || '');
}

/** Returns true when launched as an installed standalone PWA (iOS Add to Home Screen or Android PWA). */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}

/** Returns true when running on a mobile/touch browser (Android, iOS, or coarse-pointer handheld). */
export function isMobileBrowser(): boolean {
  if (isElectronDesktop() || typeof navigator === 'undefined') return false;
  if (isAndroidBrowser() || isIosBrowser() || /mobile/i.test(navigator.userAgent || '')) return true;
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches) && window.innerWidth < 1024;
}

/** Resolves the active client platform identifier. */
export function getClientPlatform(): ClientPlatform {
  if (isElectronDesktop()) return 'electron';
  if (isAndroidBrowser()) return 'android';
  if (isIosBrowser()) return 'ios';
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
