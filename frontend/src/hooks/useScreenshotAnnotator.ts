import { useEffect, useState, type MouseEvent } from 'react';
import type { AnnotationTool, ScreenshotAnnotation } from '../utils/screenshotAnnotator';

type DragState = { startX: number; startY: number; currentX: number; currentY: number };

type UseScreenshotAnnotatorArgs = {
  onPickElementRect?: (normRect: { x1: number; y1: number; x2: number; y2: number }, label: string) => void;
  onCaptureLive?: () => Promise<string | null>;
  onTextConfirmed?: (text: string) => void;
};

/** Manages screenshot annotation tools (arrows, rectangles, text, colors) and live UI element picking. */
export function useScreenshotAnnotator({ onCaptureLive, onTextConfirmed }: UseScreenshotAnnotatorArgs = {}) {
  const [tool, setTool] = useState<AnnotationTool>('arrow');
  const [color, setColor] = useState<string>('#ef4444');
  const [annotations, setAnnotations] = useState<ScreenshotAnnotation[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pendingTextPos, setPendingTextPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');
  const [pickingLive, setPickingLive] = useState(false);

  const normalizedPoint = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1)));
    return { x, y };
  };

  const onCanvasMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    const point = normalizedPoint(event);
    if (tool === 'text') {
      setPendingTextPos(point);
      setPendingTextValue('');
      return;
    }
    setDrag({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  };

  const onCanvasMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const point = normalizedPoint(event);
    setDrag(prev => (prev ? { ...prev, currentX: point.x, currentY: point.y } : null));
  };

  const onCanvasMouseUp = () => {
    if (!drag) return;
    const dx = Math.abs(drag.currentX - drag.startX);
    const dy = Math.abs(drag.currentY - drag.startY);
    if (dx > 0.01 || dy > 0.01) {
      const next: ScreenshotAnnotation =
        tool === 'blur'
          ? { id: `${Date.now()}_${Math.random()}`, type: 'blur', x1: drag.startX, y1: drag.startY, x2: drag.currentX, y2: drag.currentY }
          : {
              id: `${Date.now()}_${Math.random()}`,
              type: tool === 'rect' ? 'rect' : 'arrow',
              color,
              x1: drag.startX,
              y1: drag.startY,
              x2: drag.currentX,
              y2: drag.currentY,
            };
      setAnnotations(prev => [...prev, next]);
      if (tool === 'rect') {
        const rightEdge = Math.max(drag.startX, drag.currentX);
        const topEdge = Math.min(drag.startY, drag.currentY);
        const sideX = rightEdge < 0.7 ? rightEdge + 0.02 : Math.max(0.02, Math.min(drag.startX, drag.currentX) - 0.28);
        setPendingTextPos({ x: Math.min(0.72, sideX), y: Math.min(0.82, Math.max(0.02, topEdge)) });
        setPendingTextValue('');
      }
    }
    setDrag(null);
  };

  const confirmTextAnnotation = () => {
    const trimmed = pendingTextValue.trim();
    if (pendingTextPos && trimmed) {
      setAnnotations(prev => [
        ...prev,
        { id: `${Date.now()}_${Math.random()}`, type: 'text', color, x: pendingTextPos.x, y: pendingTextPos.y, text: trimmed },
      ]);
      onTextConfirmed?.(trimmed);
    }
    setPendingTextPos(null);
    setPendingTextValue('');
  };

  useEffect(() => {
    if (!pickingLive) return;
    const highlight = document.createElement('div');
    highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;border:3px solid #ef4444;background:rgba(239,68,68,0.14);border-radius:6px;transition:all 60ms ease-out;display:none;';
    const banner = document.createElement('div');
    banner.textContent = 'Kliknij element do poprawy (ESC anuluje)';
    banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:100000;background:#0f172a;color:#fff;border:1px solid #ef4444;padding:8px 16px;border-radius:999px;font:600 13px system-ui,sans-serif;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.45);';
    document.body.append(highlight, banner);

    const onMove = (event: globalThis.MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      if (!target || target === document.body || target === document.documentElement) {
        highlight.style.display = 'none';
        return;
      }
      const r = target.getBoundingClientRect();
      highlight.style.display = 'block';
      highlight.style.left = `${r.left}px`;
      highlight.style.top = `${r.top}px`;
      highlight.style.width = `${r.width}px`;
      highlight.style.height = `${r.height}px`;
    };

    const cleanup = () => {
      highlight.remove();
      banner.remove();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cleanup();
        setPickingLive(false);
      }
    };

    const onClick = async (event: globalThis.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const rect = target?.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      cleanup();
      if (rect && onCaptureLive) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await onCaptureLive();
        const x1 = Math.max(0, rect.left / vw);
        const y1 = Math.max(0, rect.top / vh);
        const x2 = Math.min(1, rect.right / vw);
        const y2 = Math.min(1, rect.bottom / vh);
        setAnnotations(prev => [
          ...prev,
          {
            id: `${Date.now()}_pick`,
            type: 'rect',
            color,
            x1,
            y1,
            x2,
            y2,
          },
        ]);
        const sideX = x2 < 0.7 ? x2 + 0.02 : Math.max(0.02, x1 - 0.28);
        setPendingTextPos({ x: Math.min(0.72, sideX), y: Math.min(0.82, Math.max(0.02, y1)) });
        setPendingTextValue('');
      }
      setPickingLive(false);
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', onClick, true);
    return () => {
      cleanup();
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [pickingLive, color, onCaptureLive]);

  const previewAnnotations: ScreenshotAnnotation[] = drag
    ? [
        ...annotations,
        tool === 'blur'
          ? { id: '__preview__', type: 'blur', x1: drag.startX, y1: drag.startY, x2: drag.currentX, y2: drag.currentY }
          : {
              id: '__preview__',
              type: tool === 'rect' ? 'rect' : 'arrow',
              color,
              x1: drag.startX,
              y1: drag.startY,
              x2: drag.currentX,
              y2: drag.currentY,
            },
      ]
    : annotations;

  return {
    tool, setTool,
    color, setColor,
    annotations,
    previewAnnotations,
    pendingTextPos,
    setPendingTextPos,
    pendingTextValue,
    setPendingTextValue,
    cancelTextAnnotation: () => { setPendingTextPos(null); setPendingTextValue(''); },
    confirmTextAnnotation,
    pickingLive,
    startLivePick: () => setPickingLive(true),
    undo: () => setAnnotations(prev => prev.slice(0, -1)),
    clearAnnotations: () => setAnnotations([]),
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
  };
}
