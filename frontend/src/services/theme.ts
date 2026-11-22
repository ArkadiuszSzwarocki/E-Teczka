export type ThemePreference = 'dark' | 'light' | 'system';

const THEME_KEY = 'mojateczka_theme_v1';

export function getThemePreference(): ThemePreference {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
  return 'dark';
}

export function resolveTheme(pref: ThemePreference): 'dark' | 'light' {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(pref: ThemePreference): void {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(THEME_KEY, pref);
  applyTheme(pref);
  window.dispatchEvent(new Event('mojateczka-theme-changed'));
}

/** Applies persisted theme on startup and tracks OS changes in system mode. */
export function initTheme(): void {
  applyTheme(getThemePreference());
  const media = window.matchMedia?.('(prefers-color-scheme: light)');
  media?.addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system');
  });
}
