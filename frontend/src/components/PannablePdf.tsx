import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url';

export default function PannablePdf({ url, fetcher }: { url: string; fetcher: typeof window.fetch }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(400);
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
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        current = await pdfjs.getDocument({ data }).promise;
        if (alive) setPdf(current); else void current.destroy();
      } catch { if (alive) setError('Nie udało się wyświetlić PDF. Kliknij miniaturę, aby otworzyć dokument.'); }
    })();
    return () => { alive = false; controller.abort(); if (current) void current.destroy(); };
  }, [url, fetcher]);

  useEffect(() => {
    const element = scroller.current; if (!element) return;
    const update = () => setWidth(Math.max(1, element.clientWidth - 20));
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
        const viewport = page.getViewport({ scale: (width / base.width) * zoom });
        const target = canvas.current; const context = target.getContext('2d');
        if (!context) throw new Error('Brak kontekstu obrazu.');
        target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
        task = page.render({ canvasContext: context, viewport }); await task.promise;
      } catch (failure) { if (alive && !(failure instanceof Error && failure.name === 'RenderingCancelledException')) setError('Nie udało się wyświetlić strony PDF.'); }
    };
    renderQueue.current = renderQueue.current.then(render, render);
    return () => { alive = false; task?.cancel(); };
  }, [pdf, pageNumber, zoom, width]);

  return <div className="flex h-full min-h-0 flex-col bg-[#303030]">
    <div className="flex shrink-0 items-center gap-2 bg-[#333] px-2 py-2 text-sm text-white">
      <button aria-label="Poprzednia strona" disabled={!pdf || pageNumber <= 1} onClick={() => setPageNumber(n => n - 1)} className="px-2 disabled:opacity-30">‹</button><span>{pageNumber} / {pdf?.numPages || '…'}</span><button aria-label="Następna strona" disabled={!pdf || pageNumber >= pdf.numPages} onClick={() => setPageNumber(n => n + 1)} className="px-2 disabled:opacity-30">›</button>
      <span className="mx-1 text-slate-500">|</span><button aria-label="Pomniejsz" onClick={() => setZoom(value => Math.max(0.5, value - 0.25))} className="px-2">−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Powiększ" onClick={() => setZoom(value => Math.min(4, value + 0.25))} className="px-2">+</button><span className="ml-auto text-xs text-slate-300">✋ Przeciągnij dokument</span>
    </div>
    <div ref={scroller} className={`min-h-0 flex-1 overflow-auto p-2 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`} style={{ touchAction: 'none' }}
      onPointerDown={event => { if (event.button !== 0) return; const target = event.currentTarget; drag.current = { x: event.clientX, y: event.clientY, left: target.scrollLeft, top: target.scrollTop }; target.setPointerCapture(event.pointerId); setDragging(true); }}
      onPointerMove={event => { if (!drag.current) return; event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x); event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y); }}
      onPointerUp={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }}>
      {error ? <p role="alert" className="p-3 text-sm text-red-200">{error}</p> : !pdf ? <p className="p-3 text-sm text-slate-300">Otwieranie PDF…</p> : null}
      <canvas ref={canvas} className="mx-auto block bg-white shadow-lg" />
    </div>
  </div>;
}
