import AuthenticatedImage from './AuthenticatedImage';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSensitiveMasking } from '../hooks/useSensitiveMasking';
import { shouldProtectDocument } from '../services/rodoProtection';
import { getDocumentRodoRegions, getDocumentRodoUnlockRemainingSeconds } from '../services/rodoRegions';
import type { DocumentRecord } from '../types/domain';
import { previewPosition } from '../utils/previewPosition';
import { buildDocumentFileUrl } from '../utils/documentUrl';
import PannablePdf from './PannablePdf';
import RodoRegionOverlay from './RodoRegionOverlay';

const NOOP = () => {};

export default function HoverDocumentPreview({ document: doc, anchor, apiUrl, fetcher, onEnter, onLeave }: { document: DocumentRecord; anchor: HTMLElement; apiUrl: string; fetcher: typeof window.fetch; onEnter: () => void; onLeave: () => void }) {
  const [position, setPosition] = useState({ top: 8, left: 8, width: 0, height: 0 });
  const { maskingEnabled, rodoCategories, smartRodoEnabled } = useSensitiveMasking();
  const protection = shouldProtectDocument({
    docId: doc.id,
    title: doc.title,
    ocrText: doc.ocrText,
    maskingEnabled,
    categories: rodoCategories,
    smartEnabled: smartRodoEnabled,
  });
  const regions = getDocumentRodoRegions(doc.id);
  const rodoUnlocked = getDocumentRodoUnlockRemainingSeconds(doc.id) > 0;
  const effectiveProtect = protection.protect && !rodoUnlocked;
  const effectiveRegionsMasked = regions.length > 0 && !rodoUnlocked;
  useLayoutEffect(() => {
    const update = () => {
      setPosition(previewPosition(anchor.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    };
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [anchor]);
  const source = buildDocumentFileUrl(apiUrl, doc.filePath);
  const isPdf = doc.mimeType?.includes('pdf') || doc.filePath?.toLowerCase().endsWith('.pdf');
  return createPortal(<div onMouseEnter={onEnter} onMouseLeave={onLeave} className="fixed z-[100] flex flex-col overflow-hidden rounded-lg border border-blue-500 bg-[#1e293b] shadow-[0_0_40px_rgba(0,0,0,0.8)]" style={position}>
    <div className="shrink-0 truncate border-b border-slate-700 bg-slate-800 p-2 text-xs font-bold text-blue-300">{doc.title}</div>
    <div className="relative min-h-0 flex-1 bg-white">
      {effectiveProtect ? (
        <div className="flex h-full flex-col items-center justify-center bg-[#0f172a] p-4 text-center text-xs text-slate-300">
          <span className="text-2xl">🙈</span>
          <p className="mt-2 font-bold text-white">Dokument chroniony (RODO)</p>
          <p className="mt-1 text-[11px] text-slate-400">Kliknij dokument, aby odkodować podgląd.</p>
        </div>
      ) : isPdf ? (
        <PannablePdf
          url={source}
          fetcher={fetcher}
          renderOverlay={effectiveRegionsMasked ? pageNum => (
            <RodoRegionOverlay
              regions={regions.filter(r => (r.page ?? 1) === pageNum)}
              drawMode={false}
              masked={true}
              activeLabel="RODO"
              onAddRegion={NOOP}
              onRemoveRegion={NOOP}
            />
          ) : undefined}
        />
      ) : (
        <div className="relative h-full w-full">
          <AuthenticatedImage url={source} fetcher={fetcher} alt={doc.title} className="absolute inset-0 h-full w-full" />
          {effectiveRegionsMasked && (
            <RodoRegionOverlay
              regions={regions}
              drawMode={false}
              masked={true}
              activeLabel="RODO"
              onAddRegion={NOOP}
              onRemoveRegion={NOOP}
            />
          )}
        </div>
      )}
    </div>
  </div>, document.body);
}
