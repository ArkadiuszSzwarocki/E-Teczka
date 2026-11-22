export type BackgroundStyle = 'solid' | 'aurora' | 'contrast' | 'grid';

const BG_KEY = 'mojateczka_bg_style_v1';
const BG_COLOR_KEY = 'mojateczka_bg_color_v1';

export function getBackgroundStyle(): BackgroundStyle {
  try {
    const saved = localStorage.getItem(BG_KEY);
    if (saved === 'solid' || saved === 'aurora' || saved === 'contrast' || saved === 'grid') return saved;
  } catch { /* ignore */ }
  return 'solid';
}

export function getCustomBgColor(): string {
  try {
    const saved = localStorage.getItem(BG_COLOR_KEY);
    if (saved && /^#[0-9a-f]{6}$/i.test(saved)) return saved;
  } catch { /* ignore */ }
  return '';
}

export function applyBackgroundStyle(style: BackgroundStyle, customColor = getCustomBgColor()): void {
  document.documentElement.dataset.bg = style;
  if (customColor && /^#[0-9a-f]{6}$/i.test(customColor)) {
    document.documentElement.dataset.customBg = 'true';
    document.documentElement.style.setProperty('--mojateczka-custom-bg', customColor);
  } else {
    delete document.documentElement.dataset.customBg;
    document.documentElement.style.removeProperty('--mojateczka-custom-bg');
  }
}

export function setBackgroundStyle(style: BackgroundStyle): void {
  try {
    localStorage.setItem(BG_KEY, style);
  } catch { /* ignore */ }
  applyBackgroundStyle(style);
  window.dispatchEvent(new Event('mojateczka-bg-changed'));
}

export function setCustomBgColor(color: string): void {
  const valid = /^#[0-9a-f]{6}$/i.test(color) ? color : '';
  try {
    if (valid) localStorage.setItem(BG_COLOR_KEY, valid);
    else localStorage.removeItem(BG_COLOR_KEY);
  } catch { /* ignore */ }
  applyBackgroundStyle(getBackgroundStyle(), valid);
  window.dispatchEvent(new Event('mojateczka-bg-changed'));
}

export function initBackgroundStyle(): void {
  applyBackgroundStyle(getBackgroundStyle(), getCustomBgColor());
}
