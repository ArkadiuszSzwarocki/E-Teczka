export function previewPosition(anchor: Pick<DOMRect, 'top' | 'left' | 'right'>, viewportWidth: number, viewportHeight: number) {
  const width = Math.min(500, Math.max(0, viewportWidth - 16));
  const height = Math.min(600, Math.max(0, viewportHeight - 16));
  const right = anchor.right + 8;
  const left = right + width <= viewportWidth - 8 ? right : Math.max(8, Math.min(anchor.left - width - 8, viewportWidth - width - 8));
  return { top: Math.max(8, Math.min(anchor.top, viewportHeight - height - 8)), left, width, height };
}
