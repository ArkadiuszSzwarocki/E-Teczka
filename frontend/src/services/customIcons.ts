export type CustomFolderIcon = { id: string; dataUrl: string };

const STORAGE_KEY = 'eteczka_custom_icons_v1';
export const DEFAULT_FOLDER_ICONS = ['📁', '📂', '🗂️', '💼', '🏠', '📄', '🔒', '⭐', '🏢', '🚗', '🧾', '💊'];

export function customIconLimit(plan: 'free' | 'standard' | 'premium' | 'family' | 'business'): number | null {
  if (plan === 'premium') return null;
  return plan === 'standard' ? 6 : 3;
}

export function loadCustomIcons(): CustomFolderIcon[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is CustomFolderIcon => Boolean(x && typeof x.id === 'string' && typeof x.dataUrl === 'string')) : [];
  } catch {
    return [];
  }
}

export function saveCustomIcons(icons: CustomFolderIcon[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(icons));
}

export async function fileToIconDataUrl(file: File): Promise<string> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Nie udało się odczytać pliku ikony.')));
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku ikony.'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Nieprawidłowy format obrazu ikony.'));
    el.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nie udało się przetworzyć ikony.');
  const scale = Math.min(64 / img.width, 64 / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}
