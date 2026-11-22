import { useRef, useState } from 'react';
import type { RodoRegion } from '../services/rodoRegions';

type Props = {
  regions: RodoRegion[];
  drawMode: boolean;
  masked: boolean;
  activeLabel: string;
  onAddRegion: (region: Omit<RodoRegion, 'id'>) => void;
  onRemoveRegion: (regionId: string) => void;
};

type DragRect = { startX: number; startY: number; curX: number; curY: number };

function toPercentRect(drag: DragRect): { x: number; y: number; w: number; h: number } {
  const x = Math.min(drag.startX, drag.curX);
  const y = Math.min(drag.startY, drag.curY);
  const w = Math.abs(drag.curX - drag.startX);
  const h = Math.abs(drag.curY - drag.startY);
  return { x, y, w, h };
}

const MOSAIC_STYLE: React.CSSProperties = {
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  backgroundImage:
    'repeating-conic-gradient(rgba(148, 163, 184, 0.34) 0% 25%, rgba(226, 232, 240, 0.28) 0% 50%)',
  backgroundSize: '10px 10px',
};

const DARK_CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M12 2v20M2 12h20' stroke='%23ffffff' stroke-width='3.5' stroke-linecap='round'/%3E%3Cpath d='M12 2v20M2 12h20' stroke='%230f172a' stroke-width='1.8' stroke-linecap='round'/%3E%3Ccircle cx='12' cy='12' r='2.2' fill='%230284c7'/%3E%3C/svg%3E") 12 12, crosshair`;

/** Renders mosaic-blurred RODO redactions over selected letters/numbers without opaque boxes. */
export default function RodoRegionOverlay({
  regions,
  drawMode,
  masked,
  activeLabel,
  onAddRegion,
  onRemoveRegion,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragRect | null>(null);

  const getRelativePercent = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { x, y };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawMode || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getRelativePercent(e.clientX, e.clientY);
    setDrag({ startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawMode || !drag) return;
    const pt = getRelativePercent(e.clientX, e.clientY);
    setDrag(prev => (prev ? { ...prev, curX: pt.x, curY: pt.y } : null));
  };

  const handlePointerUp = () => {
    if (!drawMode || !drag) return;
    const box = toPercentRect(drag);
    setDrag(null);
    if (box.w >= 1.2 && box.h >= 1) {
      onAddRegion({ ...box, label: activeLabel || 'RODO' });
    }
  };

  const previewRect = drag ? toPercentRect(drag) : null;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={drawMode ? { cursor: DARK_CROSSHAIR_CURSOR } : undefined}
      className={`absolute inset-0 z-20 ${drawMode ? '' : 'pointer-events-none'}`}
    >
      {regions.map(region => {
        if (!masked && !drawMode) return null;
        return (
          <div
            key={region.id}
            title={drawMode ? `RODO: ${region.label}` : 'Dane chronione (RODO)'}
            style={{
              left: `${region.x}%`,
              top: `${region.y}%`,
              width: `${region.w}%`,
              height: `${region.h}%`,
              ...(masked ? MOSAIC_STYLE : {}),
            }}
            className={`pointer-events-auto absolute select-none ${masked
                ? 'rounded-[2px]'
                : 'rounded-[2px] border border-dashed border-cyan-500 bg-transparent'
              }`}
          >
            {drawMode && (
              <button
                type="button"
                aria-label={`Usuń zaznaczenie ${region.label}`}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onRemoveRegion(region.id); }}
                className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white shadow hover:bg-red-500"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {previewRect && (
        <div
          style={{ left: `${previewRect.x}%`, top: `${previewRect.y}%`, width: `${previewRect.w}%`, height: `${previewRect.h}%` }}
          className="pointer-events-none absolute rounded-[2px] border border-dashed border-cyan-500 bg-transparent"
        />
      )}
    </div>
  );
}
