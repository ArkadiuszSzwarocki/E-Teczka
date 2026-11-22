import eteczkaFolderBlank from '../assets/mojateczka-folder-blank.png';

export const GENERATOR_BADGE_PRESETS = [
  '⚡', '🐾', '🎮', '📷', '🎵', '⚖️', '🌱', '🛠️',
  '🔑', '💊', '✈️', '🏦', '🎓', '👶', '🚗', '🏡',
  '💻', '📦', '🛡️', '❤️', '🍽️', '⚽', '📚', '🧾',
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nie udało się wczytać szablonu ikony.'));
    img.src = src;
  });
}

/**
 * Generates a 192x192 holographic 3D folder icon matching the MojaTeczka preset style,
 * projecting a glowing cyan emblem or short monogram onto the blank 3D folder cover.
 */
export async function generateHolographicFolderIcon(symbolOrText: string): Promise<string> {
  const label = symbolOrText.trim().slice(0, 4) || '★';
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Brak kontekstu graficznego Canvas.');

  const baseImg = await loadImage(eteczkaFolderBlank);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(baseImg, 0, 0, size, size);

  const isShortText = /^[a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.+-]{1,4}$/.test(label);
  const fontSize = isShortText ? (label.length <= 2 ? 32 : label.length === 3 ? 25 : 20) : 44;

  // Match the isometric front-cover angle (slopes down-right) and center of the 3D folder plate
  ctx.save();
  ctx.translate(size * 0.42, size * 0.68);
  ctx.transform(1, 0.30, 0.02, 1, 0, 0);
  ctx.font = isShortText
    ? `800 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
    : `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!isShortText) {
    ctx.filter = 'sepia(1) hue-rotate(155deg) saturate(3.4) brightness(1.18)';
  }

  // Outer cyan holographic bloom
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 16;
  ctx.fillStyle = 'rgba(186, 230, 253, 0.92)';
  ctx.fillText(label, 0, 0);

  // Crisp inner white-cyan edge
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.85)';
  ctx.strokeText(label, 0, 0);
  ctx.restore();

  return canvas.toDataURL('image/png');
}
