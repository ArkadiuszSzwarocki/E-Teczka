import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

function useScrollEdges(ref: RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ up: false, down: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const up = el.scrollTop > 8;
    const down = el.scrollTop + el.clientHeight < el.scrollHeight - 8;
    setEdges(prev => (prev.up === up && prev.down === down ? prev : { up, down }));
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(update) : null;
    mo?.observe(el, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref, update]);

  const scrollByFraction = useCallback((direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ top: direction * Math.max(160, Math.round(el.clientHeight * 0.65)), behavior: 'smooth' });
  }, [ref]);

  return { ...edges, scrollByFraction };
}

type ContainerProps = {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  downLabel?: string;
};

/** Scrollable panel without visible scrollbars, showing subtle edge fades and floating arrow pills when more content is off-screen. */
export function ScrollFadeContainer({ children, className = '', innerClassName = '', downLabel = 'Więcej kartotek' }: ContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { up, down, scrollByFraction } = useScrollEdges(scrollRef);

  return (
    <div className={`relative ${className}`}>
      <div ref={scrollRef} className={`overflow-y-auto ${innerClassName}`}>
        {children}
      </div>
      {up && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-[#0b1120]/95 via-[#0b1120]/60 to-transparent pb-4 pt-1">
          <button
            type="button"
            onClick={() => scrollByFraction(-1)}
            aria-label="Przewiń w górę"
            className="pointer-events-auto flex items-center gap-1 rounded-full border border-cyan-500/40 bg-slate-900/90 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-200 shadow-lg backdrop-blur transition hover:border-cyan-400 hover:bg-slate-800"
          >
            <span>↑</span>
          </button>
        </div>
      )}
      {down && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-[#0b1120]/95 via-[#0b1120]/65 to-transparent pb-1 pt-5">
          <button
            type="button"
            onClick={() => scrollByFraction(1)}
            aria-label="Przewiń w dół"
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-slate-900/90 px-3 py-1 text-[11px] font-semibold text-cyan-200 shadow-lg backdrop-blur transition hover:border-cyan-400 hover:bg-slate-800"
          >
            <span className="animate-bounce">↓</span>
            <span>{downLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Floating bottom-right indicator for the main app viewport when content extends above or below the fold. */
export function MainScrollIndicator({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { up, down, scrollByFraction } = useScrollEdges(containerRef);
  if (!up && !down) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-5 z-40 flex flex-col gap-1.5">
      {up && (
        <button
          type="button"
          onClick={() => scrollByFraction(-1)}
          title="Przewiń w górę"
          aria-label="Przewiń w górę"
          className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-slate-600/80 bg-slate-900/85 text-xs font-bold text-slate-200 shadow-lg backdrop-blur transition hover:border-cyan-400 hover:text-cyan-200"
        >
          ↑
        </button>
      )}
      {down && (
        <button
          type="button"
          onClick={() => scrollByFraction(1)}
          title="Więcej treści poniżej"
          aria-label="Przewiń w dół"
          className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/50 bg-slate-900/85 text-xs font-bold text-cyan-200 shadow-lg backdrop-blur transition hover:border-cyan-400 hover:bg-slate-800"
        >
          <span className="animate-bounce">↓</span>
        </button>
      )}
    </div>
  );
}
