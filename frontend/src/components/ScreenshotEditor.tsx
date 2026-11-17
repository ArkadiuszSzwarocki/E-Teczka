import { useEffect, useRef, useState } from 'react';
import {
  ANNOTATION_COLORS,
  drawAnnotationsOnCanvas,
  type AnnotationTool,
  type ScreenshotAnnotation,
} from '../utils/screenshotAnnotator';
import type { useScreenshotAnnotator } from '../hooks/useScreenshotAnnotator';

type Props = {
  imageUrl: string | null;
  annotator: ReturnType<typeof useScreenshotAnnotator>;
  capturing: boolean;
  hasDesktopCapture: boolean;
  onCaptureScreen: () => void;
  onAttachFile: (file: File | undefined) => void;
  onClearScreenshot: () => void;
};

const TOOLS: Array<{ id: AnnotationTool; label: string }> = [
  { id: 'arrow', label: '↗ Strzałka' },
  { id: 'rect', label: '▭ Kwadrat' },
  { id: 'text', label: 'T Tekst' },
];

/** Interactive screenshot annotation canvas with arrows, rectangles, text labels, colors, and live element picker. */
export default function ScreenshotEditor({
  imageUrl,
  annotator,
  capturing,
  hasDesktopCapture,
  onCaptureScreen,
  onAttachFile,
  onClearScreenshot,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  const changeZoom = (delta: number) => setZoom(prev => {
    const base = prev ?? 1;
    return Math.min(3, Math.max(0.5, Math.round((base + delta) * 100) / 100));
  });

  const repaint = (annotations: ScreenshotAnnotation[]) => {
    const canvas = canvasRef.current;
    const img = loadedImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawAnnotationsOnCanvas(ctx, canvas.width, canvas.height, annotations);
  };

  useEffect(() => {
    if (!imageUrl) { loadedImgRef.current = null; return; }
    const img = new Image();
    img.onload = () => {
      loadedImgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      repaint(annotator.previewAnnotations);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    repaint(annotator.previewAnnotations);
  }, [annotator.previewAnnotations]);

  return (
    <div className="flex min-h-0 flex-col gap-2.5 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-300">Zrzut ekranu i zaznaczanie zmian</span>
        <div className="flex flex-wrap gap-2">
          {hasDesktopCapture && (
            <>
              <button type="button" disabled={capturing} onClick={annotator.startLivePick} className="rounded border border-rose-500/60 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/40">
                🎯 Zaznacz element na żywo
              </button>
              <button type="button" disabled={capturing} onClick={onCaptureScreen} className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">
                {capturing ? 'Przechwytywanie…' : 'Zrób nowy zrzut'}
              </button>
            </>
          )}
          <label className="cursor-pointer rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">
            Wybierz obraz
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { onAttachFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {imageUrl && (
            <button type="button" onClick={() => { annotator.clearAnnotations(); onClearScreenshot(); }} className="rounded border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40">
              Usuń
            </button>
          )}
        </div>
      </div>

      {imageUrl ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
            <div className="flex flex-wrap gap-1.5">
              {TOOLS.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => annotator.setTool(item.id)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    annotator.tool === item.id ? 'bg-blue-600 text-white' : 'border border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {ANNOTATION_COLORS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  onClick={() => annotator.setColor(c.id)}
                  style={{ backgroundColor: c.id }}
                  className={`h-5 w-5 rounded-full border-2 ${annotator.color === c.id ? 'scale-110 border-white ring-2 ring-blue-400' : 'border-slate-600'}`}
                />
              ))}
              <button type="button" onClick={() => changeZoom(-0.25)} title="Pomniejsz" className="ml-2 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">−</button>
              <button type="button" onClick={() => setZoom(null)} title="Dopasuj do ekranu" className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
                {zoom ? `${Math.round(zoom * 100)}%` : 'Dopasuj'}
              </button>
              <button type="button" onClick={() => changeZoom(0.25)} title="Powiększ" className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">+</button>
              <button type="button" disabled={annotator.annotations.length === 0} onClick={annotator.undo} className="ml-2 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40">
                Cofnij
              </button>
              <button type="button" disabled={annotator.annotations.length === 0} onClick={annotator.clearAnnotations} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40">
                Wyczyść
              </button>
            </div>
          </div>

          <div
            onWheel={e => { if (e.ctrlKey) { e.preventDefault(); changeZoom(e.deltaY < 0 ? 0.25 : -0.25); } }}
            className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-700 bg-black/40 p-2"
          >
            <canvas
              ref={canvasRef}
              onMouseDown={annotator.onCanvasMouseDown}
              onMouseMove={annotator.onCanvasMouseMove}
              onMouseUp={annotator.onCanvasMouseUp}
              onMouseLeave={annotator.onCanvasMouseUp}
              style={zoom ? { width: `${zoom * 100}%`, maxWidth: 'none' } : undefined}
              className={zoom ? 'block cursor-crosshair' : 'mx-auto max-h-full max-w-full cursor-crosshair object-contain'}
            />
            {annotator.pendingTextPos && (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded-lg border border-blue-500 bg-slate-950/95 p-2 shadow-xl">
                <input
                  autoFocus
                  type="text"
                  value={annotator.pendingTextValue}
                  onChange={e => annotator.setPendingTextValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') annotator.confirmTextAnnotation();
                    if (e.key === 'Escape') annotator.cancelTextAnnotation();
                  }}
                  placeholder="Wpisz opis na zrzucie i naciśnij Enter…"
                  className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-xs text-white outline-none focus:border-blue-400"
                />
                <button type="button" onClick={annotator.confirmTextAnnotation} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">Dodaj</button>
                <button type="button" onClick={annotator.cancelTextAnnotation} className="rounded px-2 py-1.5 text-xs text-slate-400 hover:text-white">Anuluj</button>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400">Brak zrzutu. Kliknij „Zaznacz element na żywo”, wklej obraz (Ctrl+V) lub wybierz plik (maks. 2 MB).</p>
      )}
    </div>
  );
}
