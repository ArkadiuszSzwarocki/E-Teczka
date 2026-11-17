export type AnnotationTool = 'arrow' | 'rect' | 'text' | 'blur';

export type ScreenshotAnnotation =
  | { id: string; type: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { id: string; type: 'rect'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { id: string; type: 'blur'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; type: 'text'; color: string; x: number; y: number; text: string };

export const ANNOTATION_COLORS = [
  { id: '#ef4444', label: 'Czerwony' },
  { id: '#f59e0b', label: 'Żółty' },
  { id: '#22c55e', label: 'Zielony' },
  { id: '#3b82f6', label: 'Niebieski' },
  { id: '#ffffff', label: 'Biały' },
] as const;

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number) {
  const head = Math.max(14, lineWidth * 4);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawRect(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = `${color}22`;
  ctx.fillRect(x, y, w, h);
}

function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, baseSize: number) {
  const fontSize = Math.max(16, Math.round(baseSize));
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'top';
  const paddingX = Math.round(fontSize * 0.45);
  const paddingY = Math.round(fontSize * 0.25);
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + paddingX * 2;
  const boxH = fontSize + paddingY * 2;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, boxW, boxH);
  ctx.fillStyle = color;
  ctx.fillText(text, x + paddingX, y + paddingY);
}

function drawBlur(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const x = Math.max(0, Math.round(Math.min(x1, x2)));
  const y = Math.max(0, Math.round(Math.min(y1, y2)));
  const w = Math.round(Math.abs(x2 - x1));
  const h = Math.round(Math.abs(y2 - y1));
  if (w < 4 || h < 4) return;
  const pixelSize = Math.max(8, Math.round(Math.min(w, h) / 4));
  const cols = Math.max(1, Math.floor(w / pixelSize));
  const rows = Math.max(1, Math.floor(h / pixelSize));
  const small = document.createElement('canvas');
  small.width = cols;
  small.height = rows;
  const sctx = small.getContext('2d');
  if (sctx) {
    sctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, cols, rows);
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
    ctx.imageSmoothingEnabled = prevSmoothing;
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
}

/** Draws all vector annotations onto a 2D canvas scaled to its pixel dimensions. */
export function drawAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  annotations: ScreenshotAnnotation[],
) {
  const stroke = Math.max(3, Math.round(width * 0.0035));
  const fontSize = Math.max(16, Math.round(width * 0.018));
  for (const item of annotations) {
    if (item.type === 'blur') {
      drawBlur(ctx, item.x1 * width, item.y1 * height, item.x2 * width, item.y2 * height);
    } else if (item.type === 'arrow') {
      drawArrow(ctx, item.x1 * width, item.y1 * height, item.x2 * width, item.y2 * height, item.color, stroke);
    } else if (item.type === 'rect') {
      drawRect(ctx, item.x1 * width, item.y1 * height, item.x2 * width, item.y2 * height, item.color, stroke);
    } else {
      drawText(ctx, item.x * width, item.y * height, item.text, item.color, fontSize);
    }
  }
}

/** Flattens the base screenshot and all annotations into a compressed JPEG data URL. */
export function renderAnnotatedScreenshot(baseDataUrl: string, annotations: ScreenshotAnnotation[]): Promise<string> {
  if (annotations.length === 0) return Promise.resolve(baseDataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Brak obsługi canvas.')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawAnnotationsOnCanvas(ctx, canvas.width, canvas.height, annotations);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Nie udało się wyrenderować zrzutu z adnotacjami.'));
    img.src = baseDataUrl;
  });
}
