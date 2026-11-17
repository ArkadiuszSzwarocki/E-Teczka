import { useEffect, useState } from 'react';

const CLASSIC_ICONS_KEY = 'eteczka_classic_icons_v1';

function applyClassicIconAttribute(value: boolean): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.classicIcons = value ? 'true' : 'false';
  }
}

/** Returns whether classic emoji icons are enabled across the application. */
export function getUseClassicIcons(): boolean {
  const classic = localStorage.getItem(CLASSIC_ICONS_KEY) === '1';
  applyClassicIconAttribute(classic);
  return classic;
}

/** Persists the classic icon preference and notifies subscribed components. */
export function setUseClassicIcons(value: boolean): void {
  localStorage.setItem(CLASSIC_ICONS_KEY, value ? '1' : '0');
  applyClassicIconAttribute(value);
  window.dispatchEvent(new Event('eteczka-icon-style-changed'));
}

/** Subscribes to global classic/modern icon style changes. */
export function useClassicIcons(): boolean {
  const [classic, setClassic] = useState(getUseClassicIcons);
  useEffect(() => {
    applyClassicIconAttribute(getUseClassicIcons());
    const sync = () => setClassic(getUseClassicIcons());
    window.addEventListener('eteczka-icon-style-changed', sync);
    return () => window.removeEventListener('eteczka-icon-style-changed', sync);
  }, []);
  return classic;
}
