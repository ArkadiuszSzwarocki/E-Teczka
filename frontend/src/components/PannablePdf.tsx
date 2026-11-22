import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PannablePdfProps = {
  url: string;
  fetcher: typeof window.fetch;
  disablePan?: boolean;
  renderOverlay?: (pageNumber: number) => React.ReactNode;
};

export default function PannablePdf({ url, fetcher, disablePan = false, renderOverlay }: PannablePdfProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 720, h: 720 });
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const renderQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const controller = new AbortController(); let current: PDFDocumentProxy | null = null; let alive = true;
    setPdf(null); setPageNumber(1); setZoom(1); setError('');
    void (async () => {
      try {
        const response = await fetcher(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Nie udało się pobrać dokumentu.');
        const data = await response.arrayBuffer();
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const doc = await pdfjs.getDocument({ data }).promise;
        current = doc;
        if (alive) setPdf(doc); else void doc.cleanup();
      } catch { if (alive) setError('Nie udało się wyświetlić PDF. Kliknij miniaturę, aby otworzyć dokument.'); }
    })();
    return () => { alive = false; controller.abort(); if (current) void current.cleanup(); };
  }, [url, fetcher]);

  useEffect(() => {
    const element = scroller.current; if (!element) return;
    const update = () => setSize({
      w: Math.max(240, element.clientWidth - 32),
      h: Math.max(240, element.clientHeight - 32),
    });
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf) return;
    let alive = true; let task: RenderTask | null = null;
    const render = async () => {
      try {
        if (!alive) return;
        const page = await pdf.getPage(pageNumber);
        if (!alive || !canvas.current) return;
        const base = page.getViewport({ scale: 1 });
        const fitScale = Math.min(size.w / base.width, size.h / base.height, 1.5);
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const target = canvas.current; const context = target.getContext('2d');
        if (!context) throw new Error('Brak kontekstu obrazu.');
        target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
        task = page.render({ canvas: target, canvasContext: context, viewport }); await task.promise;
      } catch (failure) { if (alive && !(failure instanceof Error && failure.name === 'RenderingCancelledException')) setError('Nie udało się wyświetlić strony PDF.'); }
    };
    renderQueue.current = renderQueue.current.then(render, render);
    return () => { alive = false; task?.cancel(); };
  }, [pdf, pageNumber, zoom, size]);

  return <div className="flex h-full min-h-0 flex-col bg-slate-900">
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100">
      <button aria-label="Poprzednia strona" disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber(n => n - 1)} className="px-2 disabled:opacity-30">‹</button><span>{pageNumber} / {pdf?.numPages || '…'}</span><button aria-label="Następna strona" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => setPageNumber(n => n + 1)} className="px-2 disabled:opacity-30">›</button>
      <span className="mx-1 text-slate-500">|</span><button aria-label="Pomniejsz" onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} className="px-2">−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Powiększ" onClick={() => setZoom(value => Math.min(4, value + 0.25))} className="px-2">+</button><span className="ml-auto text-xs text-slate-300">✋ Przeciągnij dokument</span>
    </div>
    <div ref={scroller} className={`min-h-0 flex-1 overflow-auto p-2 ${disablePan ? '' : dragging ? 'cursor-grabbing' : 'cursor-grab'}`} style={{ touchAction: disablePan ? 'auto' : 'none' }}
      onPointerDown={event => { if (disablePan || event.button !== 0) return; const target = event.currentTarget; drag.current = { x: event.clientX, y: event.clientY, left: target.scrollLeft, top: target.scrollTop }; target.setPointerCapture(event.pointerId); setDragging(true); }}
      onPointerMove={event => { if (disablePan || !drag.current) return; event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x); event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y); }}
      onPointerUp={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }}>
      {error ? <p role="alert" className="p-3 text-sm text-red-200">{error}</p> : !pdf ? <p className="p-3 text-sm text-slate-300">Otwieranie PDF…</p> : null}
      <div className="flex min-h-full min-w-full items-center justify-center">
        <div className="relative w-fit shrink-0 shadow-lg">
          <canvas ref={canvas} className="block max-w-none bg-white" />
          {pdf && renderOverlay?.(pageNumber)}
        </div>
      </div>
    </div>
  </div>;
}
